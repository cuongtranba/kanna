import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import type { ResumeLoopResult } from "./loop-wake-recovery"
import { buildBoardToolList } from "./kanna-mcp-boards"
import { buildPluginToolList } from "./kanna-mcp-plugins"
import { getPluginService } from "./plugins/plugin-service-host"
import { ok, fail } from "./kanna-mcp-tool"
import type { BoardRegistry } from "./board-registry"
import { z } from "zod"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { JsonObject } from "../shared/json"
import { isRecord } from "../shared/errors"
import { statPathOrNull } from "./fs-stat.adapter"
import { KANNA_MCP_SERVER_NAME } from "../shared/tools"
import { buildProjectFileContentUrl, buildLocalFileContentUrl } from "../shared/projectFileUrl"
import { inferAttachmentContentType, inferProjectFileContentType } from "./uploads"
import type { TranscriptEntry } from "../shared/types"
import type { TunnelGateway } from "./cloudflare-tunnel/gateway"
import { createAskUserQuestionTool } from "./kanna-mcp-tools/ask-user-question"
import { createExitPlanModeTool } from "./kanna-mcp-tools/exit-plan-mode"
import { createReadTool } from "./kanna-mcp-tools/read.adapter"
import { createGlobTool } from "./kanna-mcp-tools/glob.adapter"
import { createGrepTool } from "./kanna-mcp-tools/grep.adapter"
import { createBashTool } from "./kanna-mcp-tools/bash.adapter"
import { createEditTool } from "./kanna-mcp-tools/edit.adapter"
import { createWriteTool } from "./kanna-mcp-tools/write.adapter"
import { createWebFetchTool } from "./kanna-mcp-tools/webfetch"
import { createWebSearchTool } from "./kanna-mcp-tools/websearch"
import {
  createDelegateSubagentTool,
  DELEGATE_SUBAGENT_DESCRIPTION,
  type DelegateSubagentContext,
} from "./kanna-mcp-tools/delegate-subagent"
import { formatCronArmSummary } from "../shared/cron/arm-summary"
import { parseCronCommand } from "../shared/cron/parse-command"
import { previewCronCommand } from "./cron/preview"
import type { SubagentOrchestrator } from "./subagent-orchestrator"
import type { LoopSetupInput } from "./loop-template"
import { confinePathToDir } from "./input-validation"
import { resolveStructuredDoc } from "../shared/structured-doc/registry"
import { chunkLabelFromSection, LOOP_SECTIONS } from "../shared/loop-progress"
import { readDoc, writeDoc } from "./structured-doc-io.adapter"
import { computeWorkspaceDigest, runVerifyCommand } from "./loop-verify-io.adapter"
import { getCachedVerify, setCachedVerify } from "./loop-verify-cache"
import { parseMermaid } from "./mermaid-parse.adapter"
import { validateMermaid } from "../shared/mermaid-validate"
import { formatMermaidDefect } from "../shared/mermaid-report"
import type { MermaidParsePort } from "../shared/mermaid-validation"
import type { ToolCallbackService } from "./tool-callback"
import type { ChatPermissionPolicy } from "../shared/permission-policy"
import { POLICY_DEFAULT } from "../shared/permission-policy"

// Resolves to the same element type that createSdkMcpServer accepts for its
// `tools` array, without spelling out `any` explicitly in this file.
type KannaSdkToolList = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>

export interface OfferDownloadArgs {
  projectId: string
  localPath: string
}

/**
 * Per-spawn delegation context for `mcp__kanna__delegate_subagent`.
 * Main-agent spawns set `depth: 0`, `parentSubagentId: null`,
 * `parentRunId: null`, `ancestorSubagentIds: []`. Subagent spawns set
 * the caller's own run context so cycle / depth checks apply.
 */
export interface KannaMcpDelegationContext {
  parentSubagentId: string | null
  parentRunId: string | null
  ancestorSubagentIds: string[]
  depth: number
  getParentUserMessageId: () => string | null
  getMentionedSubagentIds: () => string[]
}

export interface KannaMcpArgs extends OfferDownloadArgs {
  chatId?: string
  boardRegistry?: BoardRegistry
  sessionId?: string
  tunnelGateway?: TunnelGateway | null
  toolCallback?: ToolCallbackService
  chatPolicy?: ChatPermissionPolicy
  /** Required for delegate_subagent. Omit when subagent registry is unavailable; the tool will then be hidden from the model. */
  subagentOrchestrator?: SubagentOrchestrator
  /** Required alongside `subagentOrchestrator`. Defaults to a stub returning null when omitted. */
  delegationContext?: KannaMcpDelegationContext
  /**
   * Forces the `ask_user_question` / `exit_plan_mode` shims to register
   * even when `KANNA_MCP_TOOL_CALLBACKS` is unset. The PTY driver sets
   * this because the durable approval protocol is the only host path
   * for interactive tools under PTY (no `canUseTool` hook). Does NOT
   * register the 8 built-in shims — those stay gated on the env flag.
   */
  forceInteractiveToolCallbacks?: boolean
  /**
   * Folder-restricted subagent: per-run allowlist of absolute path roots. When
   * set, the kanna-mcp shims (read/glob/grep/bash/edit/write) auto-deny any
   * path resolving outside the listed roots. Empty / unset = no extra check.
   * Layered on top of the per-chat readPathDeny / writePathDeny.
   */
  restrictedAllowedPaths?: readonly string[]
  /**
   * Backs the `setup_loop` MCP tool. Omit to hide the tool. Handler validates
   * the loop spec, ensures the tracking file exists, and enqueues a
   * validated templated recurring prompt as an auto-continue on this chat.
   * See adr-20260711-setup-loop-template.
   */
  setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
  /**
   * Backs the `stop_loop` MCP tool. Disarms an armed loop on this chat
   * (restores tools + stops prompt re-injection). Registered alongside
   * `setup_loop` (same main-chat gating). Omit to hide the tool.
   */
  stopLoop?: () => Promise<void>
  /**
   * Backs the `resume_loop` MCP tool. Re-arms the chat's most recent loop spec
   * from the `loop_armed` tombstone. Registered alongside `setup_loop` (same
   * main-chat gating). Omit to hide the tool.
   */
  resumeLoop?: () => Promise<ResumeLoopResult>
  /**
   * Current armed-loop state for this chat, looked up per CALL. Gives the
   * tracking-doc tools the loop's workdir (so a worktree loop resolves its
   * tracking file beside the branch it describes) and `run_verify` the oracle
   * command. Omit to fall back to the chat cwd and hide `run_verify`.
   */
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
  /**
   * Backs `validate_mermaid`. Defaults to the real mermaid parser; tests
   * inject a fake so the tool suite never loads the mermaid bundle.
   */
  parseMermaid?: MermaidParsePort
  /**
   * Backs `arm_cron` — runs a `/cron` line through the normal dispatch, so a
   * model-armed job takes exactly the path a typed command takes. Omit to
   * hide the tool; supplied only for main chats, like `setup_loop`.
   */
  armCron?: (command: string) => Promise<{ jobId: string }>
  /**
   * Backs `update_cron` — edits a field on an already-armed job in place.
   * Supplied only for main chats alongside `armCron`.
   */
  updateCron?: (jobId: string, patch: import("../shared/cron/types").CronJobPatch) => Promise<void>
}

/** The slice of the armed loop the MCP tools need. */
export interface ArmedLoopInfo {
  verifyCommand: string | null
  workdirAbs: string | null
  /** Tracking file relative to `workdirAbs`; null for a loop armed before it was recorded. */
  trackingFileRel: string | null
}

export type SetupLoopHandlerResult =
  | {
      ok: true
      trackingFileRel: string
      created: boolean
      /** True when an existing tracking file was rewritten to conform to the loop schema. */
      reconciled: boolean
      /** Section-level reconcile actions taken (empty when created or already conformant). */
      reconcileActions: string[]
      /**
       * Non-fatal arm-time oracle-strength warnings (`auditOracle`). Surfaced
       * in the tool reply so a grep-shaped oracle is called out at the one
       * moment the operator can still tighten it.
       */
      oracleWarnings: string[]
      /** Fully-rendered recurring prompt (echoed back for observability). */
      prompt: string
    }
  | { ok: false; errors: string[] }

export interface ResolvedOfferDownload {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType: string
}

export async function resolveOfferDownload(
  args: OfferDownloadArgs,
  input: { path: string; label?: string },
): Promise<{ ok: true; payload: ResolvedOfferDownload } | { ok: false; error: string }> {
  const rawPath = (input.path ?? "").trim()
  if (!rawPath) {
    return { ok: false, error: "path is required" }
  }

  const relativePath = path.posix.normalize(rawPath.replaceAll("\\", "/"))
  if (
    !relativePath
    || relativePath === "."
    || relativePath.startsWith("../")
    || relativePath.includes("/../")
    || path.posix.isAbsolute(relativePath)
  ) {
    return { ok: false, error: `Invalid project file path: ${input.path}` }
  }

  const projectRoot = path.resolve(args.localPath)
  const absolutePath = path.resolve(args.localPath, relativePath)
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    return { ok: false, error: "Path resolves outside the project root" }
  }

  const info = await statPathOrNull(absolutePath)
  if (!info) {
    return { ok: false, error: `File not found: ${relativePath}` }
  }
  if (!info.isFile()) {
    return { ok: false, error: `Not a file: ${relativePath}` }
  }

  const fileName = path.posix.basename(relativePath)
  const mimeType = inferProjectFileContentType(fileName)
  const contentUrl = buildProjectFileContentUrl(args.projectId, relativePath)
  if (!contentUrl) {
    return { ok: false, error: "Failed to build project file URL" }
  }

  return {
    ok: true,
    payload: {
      contentUrl,
      relativePath,
      fileName,
      displayName: input.label?.trim() || fileName,
      size: info.size,
      mimeType,
    },
  }
}

export interface ResolvedWorkspaceFile {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType: string
}

const PREVIEWABLE_MIME_PREFIXES = ["text/", "image/", "audio/", "video/"]
const PREVIEWABLE_EXACT_MIMES = new Set(["application/json", "application/pdf"])

function isPreviewableMime(mimeType: string): boolean {
  const essence = mimeType.split(";")[0]?.trim().toLowerCase() ?? ""
  if (PREVIEWABLE_EXACT_MIMES.has(essence)) return true
  return PREVIEWABLE_MIME_PREFIXES.some((prefix) => essence.startsWith(prefix))
}

export async function resolveWorkspaceFile(
  args: { localPath: string },
  input: { path: string; label?: string },
): Promise<{ ok: true; payload: ResolvedWorkspaceFile } | { ok: false; error: string }> {
  const rawPath = (input.path ?? "").trim()
  if (!rawPath) {
    return { ok: false, error: "path is required" }
  }

  const relativePath = path.posix.normalize(rawPath.replaceAll("\\", "/"))
  if (
    !relativePath
    || relativePath === "."
    || relativePath.startsWith("../")
    || relativePath.includes("/../")
    || path.posix.isAbsolute(relativePath)
  ) {
    return { ok: false, error: `Invalid project file path: ${input.path}` }
  }

  const projectRoot = path.resolve(args.localPath)
  const absolutePath = path.resolve(args.localPath, relativePath)
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    return { ok: false, error: "Path resolves outside the project root" }
  }

  const info = await statPathOrNull(absolutePath)
  if (!info) {
    return { ok: false, error: `File not found: ${relativePath}` }
  }
  if (!info.isFile()) {
    return { ok: false, error: `Not a file: ${relativePath}` }
  }

  const fileName = path.posix.basename(relativePath)
  const mimeType = inferAttachmentContentType(fileName)

  if (!isPreviewableMime(mimeType)) {
    return {
      ok: false,
      error: `"${relativePath}" is not a previewable kind (${mimeType}) — use offer_download to let the user download it instead.`,
    }
  }

  const contentUrl = buildLocalFileContentUrl(absolutePath)

  return {
    ok: true,
    payload: {
      contentUrl,
      relativePath,
      fileName,
      displayName: input.label?.trim() || fileName,
      size: info.size,
      mimeType,
    },
  }
}

const OFFER_DOWNLOAD_DESCRIPTION = `Offer a file from the user's project workspace as an inline downloadable link in the Kanna chat UI.

Use this when you have created or generated a file the user is likely to want to download (build artifact, exported report, generated document, etc.).

Args:
- path: workspace-relative path to the file (must stay inside the project root)
- label: optional human-readable label shown next to the download link
`

const EXPOSE_PORT_DESCRIPTION = `Propose a Cloudflare Tunnel for a local port so the user can share or test the running service from outside their machine.

Call this proactively right after you start a local dev server, preview server, or any process that listens on a TCP port the user might want to expose. Pass the exact port the service is listening on. The user always sees a confirmation card in the Kanna chat UI and decides whether to accept; this tool only proposes — it never starts the tunnel itself.

Skip calling for: one-off scripts that exit immediately, internal-only databases, processes that don't accept HTTP, or ports the user has explicitly said not to expose.

Returns one of:
- proposed: a confirmation card was shown to the user (always-ask mode)
- auto_exposed: the user enabled auto-expose; cloudflared has been spawned and a URL will appear in the tunnel card shortly
- already_live: a tunnel for this port is already proposed or active in this chat
- disabled: the user has not enabled Cloudflare Tunnel in settings
- invalid_port: the port is outside the valid range
`

const PREVIEW_FILE_DESCRIPTION = `Show a file from the workspace to the user as a rich in-chat preview card in the Kanna UI. Tapping the card opens a full-screen mobile-friendly reader: markdown is typeset (mermaid/flowchart blocks render as diagrams, code blocks are syntax-highlighted), source files are syntax-highlighted, CSV becomes a table, images display inline. This is how the user READS a file on their phone without an IDE.

Call this proactively whenever the user should read a file:
- right after you create or substantially edit a spec, plan, report, or document you want the user to review
- when the user asks to see, read, show, or open a file
- when your reply refers to a file the user should read to follow along

Do NOT paste the file's content into your reply as well — call this tool and give a 1–2 sentence summary instead. Use offer_download only when the user needs the bytes (archives, binaries, exports).

Args:
- path: workspace-relative path to the file (must stay inside the project root)
- label: optional human-readable title shown on the card
`

/**
 * Adapt the SDK MCP `extra` argument into a per-entry callback that emits
 * `notifications/progress` for each persisted subagent transcript entry.
 *
 * The Claude CLI MCP client arms a transport-error watchdog (`armedAt`)
 * on any control-channel error and, after 90s without recovery, drops
 * the in-flight tool call with `"transport dropped mid-call; response
 * for tool X was lost"`. The progress callback on the CLI side resets
 * `armedAt = 0`, so a single notification every few seconds keeps a
 * multi-minute `delegate_subagent` call alive even if the underlying
 * transport blips. Returns `undefined` (no-op) when the caller did not
 * supply a `progressToken` or the MCP runtime did not expose
 * `sendNotification`.
 */
export function buildDelegateProgressEmitter<TExtra>(
  extra: TExtra,
): ((entry: TranscriptEntry) => void) | undefined {
  if (!isRecord(extra)) return undefined
  const metaRaw = extra._meta
  const meta = isRecord(metaRaw) ? metaRaw : null
  const progressToken = meta !== null && (typeof meta.progressToken === "string" || typeof meta.progressToken === "number") ? meta.progressToken : undefined
  if (progressToken === undefined) return undefined
  if (typeof extra.sendNotification !== "function") return undefined
  const rawSendNotification = extra.sendNotification
  function sendNotification(notification: { method: string; params: JsonObject }): void {
    void rawSendNotification(notification)
  }
  let progress = 0
  return (entry) => {
    progress += 1
    sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress,
        message: entry.kind === "tool_call"
          ? `tool_call:${entry.tool.toolName}`
          : entry.kind,
      },
    })
  }
}

function buildDelegateSubagentToolList(args: {
  orchestrator?: SubagentOrchestrator
  delegationContext?: KannaMcpDelegationContext
  chatId: string | null
  cwd: string
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
}): KannaSdkToolList {
  if (!args.orchestrator || !args.delegationContext || !args.chatId) return []
  const ctx = args.delegationContext
  const chatId = args.chatId
  const orchestrator = args.orchestrator
  const delegate = createDelegateSubagentTool({ orchestrator })
  const resolveLoopChunkLabel = buildLoopChunkLabelResolver({
    cwd: args.cwd,
    chatId,
    getArmedLoop: args.getArmedLoop,
  })

  return [
    tool(
      delegate.name,
      DELEGATE_SUBAGENT_DESCRIPTION,
      delegate.schema.shape,
      async (input, extra) => {
        // Reject keep_alive for non-claude subagents before delegating.
        if (input.keep_alive) {
          const subagent = orchestrator.findSubagent(input.subagent_id)
          if (subagent && subagent.provider !== "claude") {
            return fail("keep_alive is only supported for Claude subagents")
          }
        }
        const onEntry = buildDelegateProgressEmitter(extra)
        const handlerCtx: DelegateSubagentContext = {
          chatId,
          parentSubagentId: ctx.parentSubagentId,
          parentRunId: ctx.parentRunId,
          ancestorSubagentIds: ctx.ancestorSubagentIds,
          depth: ctx.depth,
          getParentUserMessageId: ctx.getParentUserMessageId,
          getMentionedSubagentIds: ctx.getMentionedSubagentIds,
          onEntry,
          resolveLoopChunkLabel,
        }
        const result = await delegate.handler(input, handlerCtx)
        // When keep_alive was requested and the run completed, append the
        // session-keep-alive hint so the model learns the run_id and knows
        // how to drive follow-up turns.
        if (input.keep_alive && !result.isError && result.content.length > 0) {
          const parsed = (() => {
            try {
              const p: { status?: string; run_id?: string } = JSON.parse(result.content[0].text)
              return p
            } catch { return null }
          })()
          if (parsed?.status === "completed" && parsed.run_id) {
            const hint = `\n\n[run_id: ${parsed.run_id}] — session kept alive; use send_subagent_message({run_id, prompt}) for more turns, close_subagent({run_id}) when done.`
            return ok(result.content[0].text + hint)
          }
        }
        return result
      },
    ),
    tool(
      "send_subagent_message",
      "Send a follow-up turn to a live subagent session started with delegate_subagent({keep_alive:true}). Blocks until that turn finishes; returns the subagent's reply.",
      {
        run_id: z.string().describe("run_id returned by delegate_subagent when keep_alive was true"),
        prompt: z.string().min(1).describe("Follow-up instructions for the subagent"),
      },
      async (input) => {
        const outcome = await orchestrator.sendToLiveRun(input.run_id, input.prompt)
        if (outcome.status === "failed") {
          return fail(`${outcome.errorCode}: ${outcome.errorMessage}`)
        }
        return ok(outcome.text)
      },
    ),
    tool(
      "close_subagent",
      "Close a live subagent session and free its process. Call when you no longer need follow-up turns.",
      {
        run_id: z.string().describe("run_id returned by delegate_subagent when keep_alive was true"),
      },
      async (input) => {
        await orchestrator.closeLiveRun(chatId, input.run_id, "explicit")
        return ok(`closed ${input.run_id}`)
      },
    ),
  ]
}

export const SETUP_LOOP_DESCRIPTION =
  "Set up an autonomous loop bound to a measurable goal. Kanna renders a "
  + "deterministic recurring prompt from your input, VALIDATES it (rejects "
  + "vague goals / unparseable verify commands / paths outside cwd), ensures "
  + "the tracking file exists (writes a skeleton if absent), then wipes this "
  + "chat's main-agent context and enqueues the templated prompt so the loop "
  + "starts on the next turn. Every iteration the main agent will: (1) read the "
  + "tracking file, (2) run the verify command, (3) if verify exits 0 print "
  + "'GOAL MET' and END the turn (loop terminates by absence of delegation), "
  + "otherwise (4) delegate the next chunk to a background subagent that "
  + "updates the tracking file. Use this instead of writing loop prompts by "
  + "hand — free-form prompts drift and lose the invariants."

const STOP_LOOP_DESCRIPTION =
  "Disarm the autonomous loop armed by setup_loop on this chat. Call this "
  + "when the goal is met (verify command exits 0) right before ending your "
  + "turn. Restores normal editing tools (Edit/Write/Task are blocked while a "
  + "loop is armed) and stops the loop prompt from being re-injected on future "
  + "turns. No-op if no loop is armed."

const RESUME_LOOP_DESCRIPTION =
  "Re-arm the loop this chat most recently ran, from the spec it was armed "
  + "with (same subagent, oracle, workdir and tracking file). Use when a loop "
  + "was disarmed and the user wants it going again — above all after a user "
  + "message disarmed it as a takeover, which is what happens whenever they "
  + "type something like \"resume\". Prefer this over re-running setup_loop: "
  + "it needs no arguments and skips the arm-time refusals. No-op if a loop is "
  + "already armed, and fails if this chat never armed one."

function buildSetupLoopToolList(args: {
  setupLoop?: (input: LoopSetupInput) => Promise<SetupLoopHandlerResult>
  stopLoop?: () => Promise<void>
  resumeLoop?: () => Promise<ResumeLoopResult>
  chatId: string | null
}): KannaSdkToolList {
  const setupLoop = args.setupLoop
  if (!setupLoop || !args.chatId) return []
  const stopLoop = args.stopLoop
  const tools: KannaSdkToolList = [
    tool(
      "setup_loop",
      SETUP_LOOP_DESCRIPTION,
      {
        goal: z
          .string()
          .min(1)
          .describe(
            "Human-readable goal. Kept short. Example: 'eslint --max-warnings=0 passes'.",
          ),
        verify_command: z
          .string()
          .min(1)
          .describe(
            "Shell command run in the project cwd. Exit code 0 = goal met. Must be shell-parseable. Example: 'bun run lint'.",
          ),
        tracking_file: z
          .string()
          .optional()
          .describe(
            "Path (relative to cwd or absolute-inside-cwd). Default PROGRESS.md at cwd root. Skeleton is auto-created if missing.",
          ),
        chunk_hint: z
          .string()
          .optional()
          .describe(
            "Optional starter description for the first chunk written into the tracking-file skeleton. Ignored if the file already exists.",
          ),
        subagent_id: z
          .string()
          .optional()
          .describe(
            "Subagent id the loop delegates each chunk to. Optional: if omitted, the configured default loop subagent (Settings) is used. Rejected if neither is set, the id is not in your roster, or that subagent is manual-trigger (a loop cannot @-mention it).",
          ),
        workdir: z
          .string()
          .optional()
          .describe(
            "Absolute directory the loop works in — where the verify command runs and where tracking_file is rooted. Defaults to this chat's working directory, which is already the card's worktree on a chat started from a board. Pass it only to point the loop at a DIFFERENT tree; it must be the project checkout or a worktree of the same repo.",
          ),
        parallelism: z
          .number()
          .int()
          .optional()
          .describe(
            "Chunks the orchestrator may delegate per turn (1-4, default 1). Above 1 only chunks the plan marks [parallel] fan out, each in its own worktree.",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Override two safety refusals: overwriting a git-tracked tracking file that records a different goal, and arming when the verify command already exits 0. Use only when you are sure.",
          ),
      },
      async (input) => {
        const result = await setupLoop({
          goal: input.goal,
          verifyCommand: input.verify_command,
          trackingFile: input.tracking_file,
          chunkHint: input.chunk_hint,
          subagentId: input.subagent_id,
          workdir: input.workdir,
          parallelism: input.parallelism,
          force: input.force,
        })
        if (!result.ok) {
          return fail(`setup_loop rejected:\n- ${result.errors.join("\n- ")}`)
        }
        let fileNote = " (existing file already conforms to the loop schema)"
        if (result.created) {
          fileNote = " (created skeleton)"
        } else if (result.reconciled) {
          fileNote = ` (existing file reconciled to the loop schema: ${result.reconcileActions.join("; ")})`
        }
        const auditNote = result.oracleWarnings.length > 0
          ? `\nOracle audit:\n- ${result.oracleWarnings.join("\n- ")}`
          : ""
        return ok(
          `Loop armed. Tracking file: ${result.trackingFileRel}${fileNote}.`
          + ` Your main-agent context has been cleared; the next turn will replay the loop prompt.${auditNote}`,
        )
      },
    ),
  ]
  if (stopLoop) {
    tools.push(
      tool(
        "stop_loop",
        STOP_LOOP_DESCRIPTION,
        {},
        async () => {
          await stopLoop()
          return ok("Loop disarmed. Normal editing tools are restored; no further loop prompts will be re-injected.")
        },
      ),
    )
  }
  const resumeLoop = args.resumeLoop
  if (resumeLoop) {
    tools.push(
      tool(
        "resume_loop",
        RESUME_LOOP_DESCRIPTION,
        {},
        async () => {
          const result = await resumeLoop()
          if (result.resumed) {
            const where = result.trackingFileRel
              ? ` Tracking ${result.trackingFileRel}${result.workdirAbs ? ` in ${result.workdirAbs}` : ""}.`
              : ""
            return ok(`Loop re-armed from its previous spec.${where} The next wake replays the loop prompt.`)
          }
          if (result.reason === "already_armed") return ok("A loop is already armed on this chat; nothing to resume.")
          return fail("This chat has no previous loop to resume. Use setup_loop to arm one.")
        },
      ),
    )
  }
  return tools
}

const QUERY_TRACKING_FILE_DESCRIPTION =
  "Read a structured markdown tracking file (e.g. the loop's PROGRESS.md) by "
  + "SECTION instead of loading the whole file. Returns only the requested "
  + "sections, so context stays bounded no matter how large the file grows on "
  + "disk. In a loop turn, query just the sections you need (e.g. 'Next chunk' "
  + "plus the latest few 'Progress' rows via list_limit) rather than reading "
  + "the entire file."

const APPEND_TRACKING_ROW_DESCRIPTION =
  "Append one entry under a section of a structured markdown tracking file "
  + "(e.g. add a Progress row to PROGRESS.md) WITHOUT reading the whole file "
  + "first. Prefer this over Edit/Write for the loop tracking file — it keeps "
  + "the append off your context. Use position 'top' for newest-first logs "
  + "like Progress."

const REPLACE_TRACKING_SECTION_DESCRIPTION =
  "Replace a section's ENTIRE body in a structured markdown tracking file, "
  + "without reading the whole file. Use this for sections that hold the "
  + "CURRENT state rather than a log — above all the loop's 'Next chunk', "
  + "which must describe exactly one next step. Appending there instead makes "
  + "completed chunks pile up, and a later iteration re-reads a finished chunk "
  + "and redoes the work. Use append_tracking_row for true logs (Progress, "
  + "Failed approaches); use this for Next chunk."

const RUN_VERIFY_DESCRIPTION =
  "Run the armed loop's verify command (the oracle) and return its exit code "
  + "and output. Prefer this over running the command yourself with Bash: the "
  + "result is CACHED against a fingerprint of the working tree, so when "
  + "nothing has changed since the last run you get the previous result "
  + "instantly instead of paying for the full gate again. The orchestrator and "
  + "the worker subagent both verify each iteration, and a real gate (lint + "
  + "typecheck + tests) costs a minute or more each time."


/**
 * Deterministic label for the chunk a loop iteration is about to delegate:
 * the armed loop's tracking file, `## Next chunk` section, first line.
 *
 * The delegation prompt itself is server-rendered boilerplate, identical every
 * iteration, so without this every Progress row read the same. The orchestrator
 * normally names the chunk in a `[chunk: …]` marker; this is the fallback for
 * when it does not, and unlike the marker it needs no model cooperation — at
 * delegate time that section IS the chunk (the worker only rewrites it once it
 * finishes).
 *
 * Returns null whenever anything is unknown (no loop armed, legacy loop with no
 * recorded tracking file, unreadable / non-markdown file, empty section). The
 * caller then falls back to the prompt's first line — a missing label must
 * never fail a delegation.
 */
function buildLoopChunkLabelResolver(args: {
  cwd: string
  chatId: string
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
}): (() => Promise<string | null>) | undefined {
  const getArmedLoop = args.getArmedLoop
  if (!getArmedLoop) return undefined
  return async () => {
    // Resolved per CALL, not per build: tools are built at spawn and
    // setup_loop arms mid-turn.
    const loop = getArmedLoop(args.chatId)
    if (!loop?.trackingFileRel) return null
    const confined = confinePathToDir(loop.trackingFileRel, loop.workdirAbs ?? args.cwd, "file")
    if ("error" in confined) return null
    const doc = resolveStructuredDoc(path.extname(confined.abs))
    if (!doc) return null
    const content = await readDoc(confined.abs)
    if (content === null) return null
    const label = chunkLabelFromSection(doc.query(content, { sections: [LOOP_SECTIONS.nextChunk] }).content)
    return label.length > 0 ? label : null
  }
}

/**
 * `query_tracking_file` + `append_tracking_row`: bound the loop tracking
 * file's context cost at the read/append boundary. Registered whenever a
 * chat is present, so both the main orchestrator and its subagents get them.
 * Paths are confined to the chat cwd; the format is dispatched by extension
 * through the structured-doc registry (`.md` today). See the loop-template
 * renderLoopPrompt which instructs the model to use these instead of Read/Edit.
 */
function buildTrackingDocToolList(args: {
  cwd: string
  chatId: string | null
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
}): KannaSdkToolList {
  if (!args.chatId) return []
  const chatId = args.chatId
  const getArmedLoop = args.getArmedLoop
  // A loop may run in a sibling git worktree (setup_loop's `workdir`), and its
  // tracking file lives beside the branch it describes. Confining to the chat
  // cwd would resolve the worker's `file:` against the wrong checkout, so the
  // armed loop's workdir wins while a loop is armed. Resolved per CALL, not
  // per build: tools are built at spawn, and setup_loop arms mid-turn.
  const baseDir = (): string => getArmedLoop?.(chatId)?.workdirAbs ?? args.cwd
  return [
    tool(
      "query_tracking_file",
      QUERY_TRACKING_FILE_DESCRIPTION,
      {
        file: z
          .string()
          .optional()
          .describe("Path relative to the loop workdir (project cwd when no loop is armed). Defaults to PROGRESS.md."),
        sections: z
          .array(z.string().min(1))
          .optional()
          .describe(
            "Section names to return, prefix-matched case-insensitively (e.g. 'progress' matches 'Progress (latest first)'). Omit to return every section.",
          ),
        list_limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Keep only the first N items of the first list in each returned section (e.g. latest N Progress rows)."),
      },
      async (input) => {
        const confined = confinePathToDir(input.file ?? "PROGRESS.md", baseDir(), "file")
        if ("error" in confined) return fail(confined.error)
        const doc = resolveStructuredDoc(path.extname(confined.abs))
        if (!doc) {
          return fail(`structured query supports .md files only (got ${confined.rel})`)
        }
        const content = await readDoc(confined.abs)
        if (content === null) return fail(`file not found: ${confined.rel}`)
        const result = doc.query(content, { sections: input.sections, listLimit: input.list_limit })
        const missingNote =
          result.missing.length > 0 ? `\n\n(no section matched: ${result.missing.join(", ")})` : ""
        const body = result.content.length > 0 ? result.content : "(no matching sections)\n"
        return ok(`${body}${missingNote}`)
      },
    ),
    tool(
      "append_tracking_row",
      APPEND_TRACKING_ROW_DESCRIPTION,
      {
        file: z
          .string()
          .optional()
          .describe("Path relative to the loop workdir (project cwd when no loop is armed). Defaults to PROGRESS.md."),
        section: z
          .string()
          .min(1)
          .describe("Target section, prefix-matched (e.g. 'progress', 'failed approaches')."),
        entry: z
          .string()
          .min(1)
          .describe("Raw markdown to insert, e.g. '- 2026-07-21 chunk 4 DONE'."),
        position: z
          .enum(["top", "bottom"])
          .optional()
          .describe("'top' inserts under the heading (newest-first logs); 'bottom' (default) appends at the end of the section."),
      },
      async (input) => {
        const confined = confinePathToDir(input.file ?? "PROGRESS.md", baseDir(), "file")
        if ("error" in confined) return fail(confined.error)
        const doc = resolveStructuredDoc(path.extname(confined.abs))
        if (!doc) {
          return fail(`structured append supports .md files only (got ${confined.rel})`)
        }
        const content = await readDoc(confined.abs)
        if (content === null) {
          return fail(`file not found: ${confined.rel} (run setup_loop to create it first)`)
        }
        const result = doc.append(content, {
          section: input.section,
          entry: input.entry,
          position: input.position,
        })
        await writeDoc(confined.abs, result.content)
        const note = result.created ? " (section created)" : ""
        return ok(`Appended to "${input.section}" in ${confined.rel}${note}.`)
      },
    ),
    ...buildReplaceTrackingSectionTool(baseDir),
  ]
}

/**
 * `replace_tracking_section`: the write op for sections that hold CURRENT
 * state rather than a log. Registered next to append for the same audience.
 */
function buildReplaceTrackingSectionTool(baseDir: () => string): KannaSdkToolList {
  return [
    tool(
      "replace_tracking_section",
      REPLACE_TRACKING_SECTION_DESCRIPTION,
      {
        file: z
          .string()
          .optional()
          .describe("Path relative to the loop workdir (project cwd when no loop is armed). Defaults to PROGRESS.md."),
        section: z
          .string()
          .min(1)
          .describe("Target section, prefix-matched (e.g. 'next chunk')."),
        body: z
          .string()
          .describe("Markdown that becomes the section's ENTIRE new body. Empty string clears it."),
      },
      async (input) => {
        const confined = confinePathToDir(input.file ?? "PROGRESS.md", baseDir(), "file")
        if ("error" in confined) return fail(confined.error)
        const doc = resolveStructuredDoc(path.extname(confined.abs))
        if (!doc) {
          return fail(`structured replace supports .md files only (got ${confined.rel})`)
        }
        const content = await readDoc(confined.abs)
        if (content === null) {
          return fail(`file not found: ${confined.rel} (run setup_loop to create it first)`)
        }
        const result = doc.replace(content, { section: input.section, body: input.body })
        await writeDoc(confined.abs, result.content)
        const note = result.created ? " (section created)" : ""
        return ok(`Replaced "${input.section}" in ${confined.rel}${note}.`)
      },
    ),
  ]
}

/**
 * `run_verify`: run the armed loop's oracle, memoized on a fingerprint of the
 * working tree. Hidden unless a loop is armed with a recorded verify command —
 * there is nothing to run otherwise, and inventing one would be worse than
 * absent.
 */
function buildRunVerifyToolList(args: {
  chatId: string | null
  cwd: string
  getArmedLoop?: (chatId: string) => ArmedLoopInfo | null
}): KannaSdkToolList {
  const { chatId, getArmedLoop } = args
  if (!chatId || !getArmedLoop) return []
  return [
    tool(
      "run_verify",
      RUN_VERIFY_DESCRIPTION,
      {
        force: z
          .boolean()
          .optional()
          .describe("Re-run even when a cached result exists for the current working tree."),
      },
      async (input) => {
        const loop = getArmedLoop(chatId)
        if (!loop?.verifyCommand) {
          return fail(
            "no armed loop with a recorded verify command on this chat — run the command with Bash, or re-arm the loop via setup_loop.",
          )
        }
        const command = loop.verifyCommand
        const cwd = loop.workdirAbs ?? args.cwd
        const digest = await computeWorkspaceDigest(cwd)
        if (input.force !== true) {
          const hit = getCachedVerify(chatId, command, digest)
          if (hit) {
            return ok(
              `exit=${hit.exitCode} (cached — the working tree has not changed since this ran`
              + ` in ${hit.durationMs}ms)\n${hit.output}`,
            )
          }
        }
        const result = await runVerifyCommand({ command, cwd, timeoutMs: VERIFY_TOOL_TIMEOUT_MS })
        // A timed-out run says nothing about the tree, so it is not cached.
        if (!result.timedOut) {
          setCachedVerify(chatId, command, digest, result)
        }
        const timedOutNote = result.timedOut ? " (TIMED OUT)" : ""
        return ok(`exit=${result.exitCode}${timedOutNote} (${result.durationMs}ms)\n${result.output}`)
      },
    ),
  ]
}

/** Wall-clock bound for one `run_verify` call. A real gate is minutes, not seconds. */
const VERIFY_TOOL_TIMEOUT_MS = 900_000

const VALIDATE_MERMAID_DESCRIPTION =
  "Check that a Mermaid diagram parses BEFORE you put it in a message. Kanna "
  + "renders mermaid inline, so a syntax error reaches the user as a broken "
  + "diagram. Pass the diagram source without the ``` fence; a rejection comes "
  + "back with the offending line, mermaid's own caret excerpt, and what to "
  + "change. Cheap (a few milliseconds) — call it for every diagram you write."

/**
 * `validate_mermaid`: the in-turn half of the mermaid validation gate. The
 * model fixes its own diagram before anyone sees it, which costs no extra
 * turn; the end-of-turn guard exists only for the turns where this was
 * skipped.
 *
 * Registered whenever a chat is present, so subagents get it too — a subagent
 * reply is rendered in the transcript the same as a main-turn one.
 */
function buildValidateMermaidToolList(args: {
  chatId: string | null
  parse: MermaidParsePort
}): KannaSdkToolList {
  if (!args.chatId) return []
  const parse = args.parse
  return [
    tool(
      "validate_mermaid",
      VALIDATE_MERMAID_DESCRIPTION,
      {
        source: z
          .string()
          .describe("The complete diagram source, without the surrounding ``` fence."),
      },
      async (input) => {
        const validation = await validateMermaid(parse, input.source)
        if (validation.ok) return ok("VALID")
        return fail(formatMermaidDefect(validation.defect))
      },
    ),
  ]
}

const VALIDATE_CRON_DESCRIPTION =
  "Check a `/cron` line BEFORE you schedule anything with it. Pass the complete "
  + "line (`/cron <instruction> inline|spawn <schedule>`) and get back the "
  + "schedule in plain words plus the next few real fire times — which is how "
  + "you confirm `0 9 * * *` means the 09:00-daily the user actually asked for. "
  + "A rejection names the failing part and why. Cheap; call it for every line "
  + "you are about to arm or suggest. Sub-minute schedules are supported and "
  + "have no floor — `every 2s` and the 6-field `*/2 * * * * *` both arm, so "
  + "ask this tool instead of assuming a one-minute minimum."

const ARM_CRON_DESCRIPTION =
  "Schedule a `/cron` line on this chat — use it to finish repairing a command "
  + "the user mistyped, once you know what they meant. Takes the complete line "
  + "and runs it through the same dispatch a typed command takes, so anything "
  + "the user could not have typed is refused here too. Validate with "
  + "validate_cron first. Pre-arm: if the user's intent is genuinely ambiguous "
  + "(the mode is neither stated nor implied, the time could mean more than one "
  + "thing), ask them with AskUserQuestion before arming — do not guess. "
  + "Post-arm: after a successful arm, present the full configuration to the user "
  + "and confirm it with AskUserQuestion — options: Confirm / Change schedule / "
  + "Change mode / Change instruction / Disarm. If they choose a change, call "
  + "arm_cron again with the corrected line and remove the old job with "
  + "`/cron remove <jobId>`."

/**
 * The `/cron` pair, mirroring the mermaid gate: `validate_cron` is the in-turn
 * oracle, `arm_cron` is the act it enables. Both answer from
 * `previewCronCommand`, so the model can never be told a line is valid by one
 * and refused by the other.
 *
 * `validate_cron` gates on a chat only — checking a line is free of
 * consequence. `arm_cron` additionally needs the injected capability, which
 * the spawner supplies for main chats alone: a subagent's chat is ephemeral
 * and must not leave recurring work behind.
 */
function buildCronToolList(args: {
  chatId: string | null
  armCron?: (command: string) => Promise<{ jobId: string }>
  updateCron?: (jobId: string, patch: import("../shared/cron/types").CronJobPatch) => Promise<void>
  now?: () => number
}): KannaSdkToolList {
  if (!args.chatId) return []
  const now = args.now ?? (() => Date.now())
  const commandArg = {
    command: z
      .string()
      .describe("The complete /cron line, e.g. `/cron check CI inline 0 9 * * *`."),
  }

  const tools: KannaSdkToolList = [
    tool("validate_cron", VALIDATE_CRON_DESCRIPTION, commandArg, (input) => {
      const preview = previewCronCommand(input.command, now())
      if (!preview.ok) return Promise.resolve(fail(preview.reason))
      return Promise.resolve(ok(formatCronArmSummary(preview.summary)))
    }),
  ]

  const armCron = args.armCron
  if (!armCron) return tools

  tools.push(
    tool("arm_cron", ARM_CRON_DESCRIPTION, commandArg, async (input) => {
      const preview = previewCronCommand(input.command, now())
      if (!preview.ok) return fail(`Not armed. ${preview.reason}`)
      const { jobId } = await armCron(input.command)
      const text = [
        `Armed as ${jobId}.`,
        formatCronArmSummary(preview.summary),
        "",
        "Now show this configuration to the user and confirm it with AskUserQuestion —",
        "options: Confirm / Change schedule / Change mode / Change instruction / Disarm.",
        `If they choose a change, call update_cron with jobId "${jobId}" and the field to change — no need to remove and re-arm.`,
      ].join("\n")
      return ok(text)
    }),
  )

  const updateCron = args.updateCron
  if (updateCron) {
    tools.push(
      tool(
        "update_cron",
        "Edit one field (schedule, mode, or instruction) of an already-armed cron job in place. " +
          "Use instead of arm_cron + /cron remove when the user wants to change a single field. " +
          "Call validate_cron first when changing the schedule. " +
          "After a successful update, show the user what changed and confirm with AskUserQuestion.",
        {
          jobId: z.string().describe("The job ID returned by arm_cron or listed by /cron list."),
          field: z
            .enum(["schedule", "mode", "instruction"])
            .describe("Which field to change."),
          value: z
            .string()
            .describe(
              "New value: a cron expression / shortcut / interval for schedule, 'inline' or 'spawn' for mode, or free text for instruction.",
            ),
        },
        async (input) => {
          const line = `/cron update ${input.jobId} ${input.field} ${input.value}`
          const parsed = parseCronCommand(line)
          if (!parsed?.ok) {
            return fail(`Not updated. ${parsed ? parsed.error.message : "could not parse as an update command"}`)
          }
          if (parsed.command.sub !== "update") {
            return fail("Not updated. The constructed command was not recognized as an update.")
          }
          await updateCron(input.jobId, parsed.command.patch)
          return ok(`Updated ${input.field} on job ${input.jobId}. Show the user the change and confirm with AskUserQuestion.`)
        },
      ),
    )
  }
  return tools
}

export function buildKannaMcpTools(args: KannaMcpArgs): KannaSdkToolList {
  const tunnelGateway = args.tunnelGateway ?? null
  const chatId = args.chatId ?? null
  const sessionId = args.sessionId ?? ""
  const chatPolicy = args.chatPolicy ?? POLICY_DEFAULT
  const cwd = args.localPath

  const tools: KannaSdkToolList = [
    tool(
      "offer_download",
      OFFER_DOWNLOAD_DESCRIPTION,
      {
        path: z.string().describe("Workspace-relative path to the file to offer for download"),
        label: z.string().optional().describe("Optional human-readable label for the download link"),
      },
      async (input) => {
        const result = await resolveOfferDownload(args, input)
        if (!result.ok) return fail(result.error)
        return ok(JSON.stringify({ kind: "download_offer", ...result.payload }))
      },
    ),
    tool(
      "preview_file",
      PREVIEW_FILE_DESCRIPTION,
      {
        path: z.string().describe("Workspace-relative path to the file to preview"),
        label: z.string().optional().describe("Optional human-readable title shown on the card"),
      },
      async (input) => {
        const result = await resolveWorkspaceFile(args, input)
        if (!result.ok) return fail(result.error)
        return ok(JSON.stringify({ kind: "file_preview", ...result.payload }))
      },
    ),
    ...buildDelegateSubagentToolList({
      orchestrator: args.subagentOrchestrator,
      delegationContext: args.delegationContext,
      chatId,
      cwd,
      getArmedLoop: args.getArmedLoop,
    }),
    ...buildSetupLoopToolList({ setupLoop: args.setupLoop, stopLoop: args.stopLoop, resumeLoop: args.resumeLoop, chatId }),
    ...buildTrackingDocToolList({ cwd, chatId, getArmedLoop: args.getArmedLoop }),
    // The board is the agent's work queue: read your column, advance your card.
    // Scoped to the chat's project and context-bounded — see the module header.
    ...buildBoardToolList({ boardRegistry: args.boardRegistry, chatId, projectId: args.projectId ?? null }, tool),
    // Plugin authoring. `getPluginService()` is the ONE service the CLI and the
    // HTTP surface also drive — a second one would keep a second registry.
    // Mutating tools (scaffold/install/reload) are withheld at depth > 0.
    ...buildPluginToolList(getPluginService(), chatId, args.delegationContext?.depth ?? 0, tool),
    ...buildRunVerifyToolList({ chatId, cwd, getArmedLoop: args.getArmedLoop }),
    ...buildValidateMermaidToolList({ chatId, parse: args.parseMermaid ?? parseMermaid }),
    ...buildCronToolList({ chatId, armCron: args.armCron, updateCron: args.updateCron }),
  ]

  if (tunnelGateway && chatId) {
    const boundGateway = tunnelGateway
    const boundChatId = chatId
    tools.push(
      tool(
        "expose_port",
        EXPOSE_PORT_DESCRIPTION,
        {
          port: z.number().int().min(1).max(65535).describe("Local TCP port the running service is listening on"),
          reason: z.string().optional().describe("Brief description of the service (e.g. \"vite dev server\") shown to the user"),
        },
        async (input) => {
          const outcome = await boundGateway.proposeFromTool({ chatId: boundChatId, port: input.port })
          if (outcome.status === "invalid_port") return fail(outcome.reason)
          return ok(JSON.stringify({ kind: "expose_port_result", ...outcome, reason: input.reason ?? null }))
        },
      ),
    )
  }

  // Two independent gates:
  //  • interactive (ask_user_question / exit_plan_mode): on when the env
  //    flag is set OR the caller forces it. The PTY driver forces it
  //    because the durable approval protocol is the only host path for
  //    interactive tools under PTY (no canUseTool hook). See issue #215.
  //  • built-in shims (read/glob/grep/bash/edit/write/webfetch/websearch):
  //    gated on the env flag ONLY. Never force-registered — under PTY they
  //    would duplicate the native CLI built-ins and route every bash/edit
  //    through an approval prompt, contradicting --dangerously-skip-permissions.
  const envCallbacksEnabled = process.env.KANNA_MCP_TOOL_CALLBACKS === "1"
  const interactiveEnabled =
    (envCallbacksEnabled || args.forceInteractiveToolCallbacks === true) && Boolean(args.toolCallback)
  const builtinShimsEnabled = envCallbacksEnabled && Boolean(args.toolCallback)

  if (interactiveEnabled && args.toolCallback) {
    const askTool = createAskUserQuestionTool({ toolCallback: args.toolCallback })
    const exitPlanTool = createExitPlanModeTool({ toolCallback: args.toolCallback })

    tools.push(
      tool(
        askTool.name,
        "Ask the user a question with multiple choice answers",
        askTool.schema.shape,
        async (input, extra) => {
          const requestId = isRecord(extra) && (typeof extra.requestId === "string" || typeof extra.requestId === "number") ? extra.requestId : undefined
          const toolUseId = requestId != null ? String(requestId) : randomUUID()
          return await askTool.handler(input, {
            chatId: chatId ?? "",
            sessionId,
            toolUseId,
            cwd,
            chatPolicy,
          })
        },
      ),
      tool(
        exitPlanTool.name,
        "Submit a plan for user approval before continuing",
        exitPlanTool.schema.shape,
        async (input, extra) => {
          const requestId = isRecord(extra) && (typeof extra.requestId === "string" || typeof extra.requestId === "number") ? extra.requestId : undefined
          const toolUseId = requestId != null ? String(requestId) : randomUUID()
          return await exitPlanTool.handler(input, {
            chatId: chatId ?? "",
            sessionId,
            toolUseId,
            cwd,
            chatPolicy,
          })
        },
      ),
    )
  }

  if (builtinShimsEnabled && args.toolCallback) {
    const readTool = createReadTool({ toolCallback: args.toolCallback })
    const globTool = createGlobTool({ toolCallback: args.toolCallback })
    const grepTool = createGrepTool({ toolCallback: args.toolCallback })
    const bashTool = createBashTool({ toolCallback: args.toolCallback })
    const editTool = createEditTool({ toolCallback: args.toolCallback })
    const writeTool = createWriteTool({ toolCallback: args.toolCallback })
    const webfetchTool = createWebFetchTool({ toolCallback: args.toolCallback })
    const websearchTool = createWebSearchTool({ toolCallback: args.toolCallback })

    /**
     * The shim's own zod schema is the decoder. It used to be `<I>input` — an
     * assertion that the MCP SDK had already validated the payload — which is
     * both banned and unprovable here. `safeParse` turns the same claim into a
     * runtime check, and a payload that fails it becomes an error result rather
     * than a crash inside the handler.
     */
    function registerShim<TSchema extends z.ZodObject<z.ZodRawShape>>(shim: {
      name: string
      schema: TSchema
      handler: (input: z.infer<TSchema>, ctx: import("./kanna-mcp-tools/tool-callback-shim").ToolHandlerContext) => Promise<import("./kanna-mcp-tools/tool-callback-shim").ToolHandlerResult>
    }) {
      tools.push(
        tool(
          shim.name,
          `Kanna built-in replacement for ${shim.name}.`,
          shim.schema.shape,
          async (input, extra) => {
            const requestId = isRecord(extra) && (typeof extra.requestId === "string" || typeof extra.requestId === "number") ? extra.requestId : undefined
            const toolUseId = requestId != null ? String(requestId) : randomUUID()
            const parsed = shim.schema.safeParse(input)
            if (!parsed.success) {
              return fail(`Invalid arguments for ${shim.name}: ${parsed.error.message}`)
            }
            return await shim.handler(parsed.data, {
              chatId: chatId ?? "",
              sessionId,
              toolUseId,
              cwd,
              chatPolicy,
              restrictedAllowedPaths: args.restrictedAllowedPaths,
            })
          },
        ),
      )
    }
    registerShim(readTool)
    registerShim(globTool)
    registerShim(grepTool)
    registerShim(bashTool)
    registerShim(editTool)
    registerShim(writeTool)
    registerShim(webfetchTool)
    registerShim(websearchTool)
  }

  return tools
}

export function createKannaMcpServer(args: KannaMcpArgs) {
  return createSdkMcpServer({
    name: KANNA_MCP_SERVER_NAME,
    tools: buildKannaMcpTools(args),
  })
}
