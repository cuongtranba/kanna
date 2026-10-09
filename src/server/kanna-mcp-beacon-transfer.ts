import { z } from "zod"
import type { BeaconConfig } from "../shared/beacon-config"
import type { BeaconRequest } from "../shared/beacon-protocol"
import { SHA256_HEX } from "../shared/beacon-transfer"
import { errorMessage, isRecord } from "../shared/errors"
import { isJsonObject, type JsonValue } from "../shared/json"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import type { BeaconDispatchOptions, BeaconDispatchOutcome } from "./kanna-mcp-beacon"
import type { BeaconTransferFiles } from "./beacon-transfer-files"
import type { BeaconTransferTickets, TicketEndReason, TransferTicket } from "./beacon-transfer-tickets"
import { ok, fail, type ToolArgs, type ToolResult } from "./kanna-mcp-tool"
import { pathMatchesDeny } from "./permission-gate"

export interface BeaconTransferToolContext {
  chatId: string
  projectRoot: string
  tickets: BeaconTransferTickets
  files: BeaconTransferFiles
  maxPullBytes: () => number | undefined
  chatPolicy: ChatPermissionPolicy | undefined
  resolveBeacon: (input: ToolArgs) => BeaconConfig | string
  authorize: (beacon: BeaconConfig, name: string, input: ToolArgs) => Promise<string | null>
  dispatch: (beaconId: string, request: BeaconRequest, options: BeaconDispatchOptions) => Promise<BeaconDispatchOutcome>
  describeBeacon: (beacon: BeaconConfig) => string
  captureBytes: number | undefined
}

export type BeaconTransferToolFactory<TTool, TExtra> = (
  name: string,
  description: string,
  schema: Record<string, z.ZodType<JsonValue | undefined>>,
  handler: (input: ToolArgs, extra?: TExtra) => Promise<ToolResult>,
) => TTool

const PULL_DESCRIPTION =
  "Copy ONE file from a beacon (a paired remote machine) into this project, streamed straight to disk and verified with "
  + "a SHA-256 on both sides. Use this for any file larger than a few KB and for any binary; the bytes never enter your "
  + "context. Never move files with beacon_script plus credentials or cookies. `path` is the file on the beacon and must "
  + "be inside its read folders. `dest` is a project-relative destination; by default the file lands in "
  + ".kanna/uploads/<name> and a taken name gets a numbered copy. An explicit `dest` that already exists is refused "
  + "unless `overwrite` is true."

const PUSH_DESCRIPTION =
  "Copy ONE file from this project onto a beacon (a paired remote machine), streamed from disk and verified with a "
  + "SHA-256 on both sides. Use this for any file larger than a few KB and for any binary; the bytes never enter your "
  + "context. Never move files with beacon_script plus credentials or cookies. `source` is project-relative; `path` is "
  + "the absolute destination on the beacon and must be inside a write folder the user configured for that machine "
  + "(without one the push is refused). An existing destination is refused unless `overwrite` is true."

const END_MESSAGES: Record<TicketEndReason, string> = {
  completed: "the transfer finished",
  failed: "the server rejected the transfer (size or checksum did not match)",
  revoked: "the transfer was cancelled",
  idle: "no data moved within the idle timeout, so the transfer was abandoned",
}

function abortSignalOf<TExtra>(extra: TExtra | undefined): AbortSignal | undefined {
  if (!isRecord(extra)) return undefined
  const signal = extra.signal
  return signal instanceof AbortSignal ? signal : undefined
}

function interruptOnEnd(tickets: BeaconTransferTickets, token: string, signal: AbortSignal | undefined) {
  return (stop: (message: string) => void): (() => void) => {
    const unwatch = tickets.watch(token, (reason) => {
      if (reason !== "completed") stop(END_MESSAGES[reason])
    })
    const onAbort = () => stop("the call was cancelled")
    if (signal?.aborted === true) onAbort()
    signal?.addEventListener("abort", onAbort, { once: true })
    return () => {
      unwatch()
      signal?.removeEventListener("abort", onAbort)
    }
  }
}

function readText(input: ToolArgs, key: string): string | undefined {
  const value = input[key]
  return typeof value === "string" && value !== "" ? value : undefined
}

function formatCount(bytes: number): string {
  return bytes.toLocaleString("en-US")
}

interface ReportedTransfer {
  path: string
  bytes: number
  sha256: string
}

function parseReport(result: JsonValue | undefined): ReportedTransfer | null {
  if (result === undefined || !isJsonObject(result)) return null
  const { path, bytes, sha256 } = result
  if (typeof path !== "string" || typeof bytes !== "number" || typeof sha256 !== "string") return null
  return SHA256_HEX.test(sha256) ? { path, bytes, sha256 } : null
}

export function buildBeaconTransferTools<TTool, TExtra>(
  ctx: BeaconTransferToolContext,
  tool: BeaconTransferToolFactory<TTool, TExtra>,
): TTool[] {
  const { tickets, files } = ctx

  function refusal(beacon: BeaconConfig, name: string, reason: string): ToolResult {
    return fail(`Beacon ${ctx.describeBeacon(beacon)}: ${name} refused: ${reason}`)
  }

  async function runTransfer(
    beacon: BeaconConfig,
    ticket: TransferTicket,
    request: BeaconRequest,
    signal: AbortSignal | undefined,
  ): Promise<ReportedTransfer> {
    const outcome = await ctx.dispatch(beacon.id, request, {
      captureBytes: ctx.captureBytes,
      timeoutMs: null,
      interrupt: interruptOnEnd(tickets, ticket.token, signal),
    })
    const report = parseReport(outcome.result)
    if (report === null) throw new Error("the beacon finished without reporting path, bytes and sha256")
    return report
  }

  async function pull(input: ToolArgs, extra?: TExtra): Promise<ToolResult> {
    const beacon = ctx.resolveBeacon(input)
    if (typeof beacon === "string") return fail(beacon)
    const beaconPath = readText(input, "path")
    if (beaconPath === undefined) return fail(`Beacon ${ctx.describeBeacon(beacon)}: beacon_pull is missing a required argument`)
    const overwrite = input.overwrite === true
    const destination = await files.resolvePullDestination({
      projectRoot: ctx.projectRoot,
      dest: readText(input, "dest"),
      beaconPath,
      overwrite,
    })
    if (!destination.ok) return refusal(beacon, "beacon_pull", destination.error)
    const denied = pathMatchesDeny(destination.kannaPath, ctx.chatPolicy?.writePathDeny ?? [])
    if (denied !== null) return refusal(beacon, "beacon_pull", `writing there is blocked by the chat policy (${denied})`)
    const declined = await ctx.authorize(beacon, "beacon_pull", input)
    if (declined !== null) return fail(declined)
    await files.discardPart(destination.kannaPath)
    const ticket = tickets.mint({
      beaconId: beacon.id,
      chatId: ctx.chatId,
      direction: "upload",
      kannaPath: destination.kannaPath,
      workspacePath: destination.workspacePath,
      beaconPath,
      overwrite,
      maxBytes: ctx.maxPullBytes(),
    })
    try {
      const report = await runTransfer(
        beacon,
        ticket,
        { op: "upload", path: beaconPath, ticket: ticket.token },
        abortSignalOf(extra),
      )
      const settled = tickets.inspect(ticket.token)
      if (settled?.state !== "completed" || settled.outcome === undefined) {
        throw new Error("the beacon reported success but Kanna never received a verified file")
      }
      if (settled.outcome.bytes !== report.bytes || settled.outcome.sha256 !== report.sha256) {
        throw new Error("the beacon's report does not match what Kanna received")
      }
      return ok(
        `Pulled ${beaconPath} from ${ctx.describeBeacon(beacon)} into ${destination.workspacePath} — `
        + `${formatCount(report.bytes)} bytes, sha256 ${report.sha256} (verified on both sides).`,
      )
    } catch (error) {
      tickets.revoke(ticket.token)
      await files.discardPart(destination.kannaPath)
      return fail(`Beacon ${ctx.describeBeacon(beacon)} beacon_pull failed: ${errorMessage(error)}`)
    } finally {
      tickets.release(ticket.token)
    }
  }

  async function push(input: ToolArgs, extra?: TExtra): Promise<ToolResult> {
    const beacon = ctx.resolveBeacon(input)
    if (typeof beacon === "string") return fail(beacon)
    const beaconPath = readText(input, "path")
    const sourceArg = readText(input, "source")
    if (beaconPath === undefined || sourceArg === undefined) {
      return fail(`Beacon ${ctx.describeBeacon(beacon)}: beacon_push is missing a required argument`)
    }
    const overwrite = input.overwrite === true
    const source = await files.resolvePushSource(ctx.projectRoot, sourceArg)
    if (!source.ok) return refusal(beacon, "beacon_push", source.error)
    const denied = pathMatchesDeny(source.kannaPath, ctx.chatPolicy?.readPathDeny ?? [])
    if (denied !== null) return refusal(beacon, "beacon_push", `reading ${sourceArg} is blocked by the chat policy (${denied})`)
    const declined = await ctx.authorize(beacon, "beacon_push", input)
    if (declined !== null) return fail(declined)
    try {
      const digest = await files.hashFile(source.kannaPath)
      const ticket = tickets.mint({
        beaconId: beacon.id,
        chatId: ctx.chatId,
        direction: "download",
        kannaPath: source.kannaPath,
        workspacePath: source.workspacePath,
        beaconPath,
        size: digest.bytes,
        sha256: digest.sha256,
        overwrite,
      })
      try {
        const report = await runTransfer(
          beacon,
          ticket,
          { op: "download", path: beaconPath, ticket: ticket.token, size: digest.bytes, sha256: digest.sha256, overwrite },
          abortSignalOf(extra),
        )
        if (report.bytes !== digest.bytes || report.sha256 !== digest.sha256) {
          throw new Error("the beacon's report does not match the file that was sent")
        }
        tickets.complete(ticket.token, { bytes: report.bytes, sha256: report.sha256 })
        return ok(
          `Pushed ${source.workspacePath} to ${report.path} on ${ctx.describeBeacon(beacon)} — `
          + `${formatCount(report.bytes)} bytes, sha256 ${report.sha256} (verified on both sides).`,
        )
      } catch (error) {
        tickets.revoke(ticket.token)
        throw error
      } finally {
        tickets.release(ticket.token)
      }
    } catch (error) {
      return fail(`Beacon ${ctx.describeBeacon(beacon)} beacon_push failed: ${errorMessage(error)}`)
    }
  }

  const beaconId = z.string().min(1).describe("Id of the beacon, from beacon_list")
  const overwrite = z.boolean().optional()

  return [
    tool(
      "beacon_pull",
      PULL_DESCRIPTION,
      { beaconId, path: z.string().min(1), dest: z.string().min(1).optional(), overwrite },
      pull,
    ),
    tool(
      "beacon_push",
      PUSH_DESCRIPTION,
      { beaconId, source: z.string().min(1), path: z.string().min(1), overwrite },
      push,
    ),
  ]
}
