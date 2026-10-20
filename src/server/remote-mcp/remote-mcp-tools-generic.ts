import type { ToolRegistrar } from "./remote-mcp-tool-registrar"
import { z } from "zod"
import { jsonObjectSchema } from "../../shared/genui/json-schema"
import { isCommandType, listCommandDescriptors, parseClientCommand, remotePolicyOf } from "../../shared/commands"
import { parseSubscriptionTopic } from "../../shared/remote-mcp/topics"
import { fail, ok } from "../kanna-mcp-tool"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { acceptedReport, guardedChatSend, guardedEnqueue } from "./remote-mcp-follow"
import type { RemoteMcpHost } from "./remote-mcp-server"

const KANNA_COMMANDS_DESCRIPTION =
  "List every Kanna command with its domain, summary, risk, whether it can run remotely (with the reason when it cannot) and a JSON Schema of its params."
const KANNA_COMMAND_DESCRIPTION =
  "Run one Kanna command (the same operations the web UI performs) by its dotted type, for example chat.rename or board.card.move. "
  + "Call kanna_commands first to see each command's params (JSON Schema) and risk; destructive commands delete or discard data, local commands act on the host machine. "
  + "Prefer send_message over chat.send: kanna_command returns as soon as the message is accepted and does not wait, and an identical chat.send or message.enqueue "
  + "to a chat that is already working on it is suppressed as a duplicate. Follow a chat with wait_for_chat."
const KANNA_READ_DESCRIPTION =
  "Read the current snapshot of one subscription topic, for example {\"type\":\"sidebar\"} or {\"type\":\"chat\",\"chatId\":\"...\"}."

export function registerGenericTools(tools: ToolRegistrar, host: RemoteMcpHost): void {
  tools.registerTool(
    "ping",
    {
      title: "Ping",
      inputSchema: z.object({}),
      description: "Liveness check; answers pong.",
      annotations: { readOnlyHint: true },
    },
    () => ok("pong"),
  )

  tools.registerTool(
    "kanna_commands",
    {
      title: "List Kanna commands",
      description: KANNA_COMMANDS_DESCRIPTION,
      inputSchema: z.object({ domain: z.string().optional().describe("Only commands in this domain, such as chat or board") }),
      annotations: { readOnlyHint: true },
    },
    ({ domain }) => ok(JSON.stringify(listCommandDescriptors(domain))),
  )

  tools.registerTool(
    "kanna_command",
    {
      title: "Run a Kanna command",
      description: KANNA_COMMAND_DESCRIPTION,
      inputSchema: z.object({
        type: z.string().describe("Dotted command type, such as chat.rename"),
        params: jsonObjectSchema.optional().describe("The command's parameters as an object"),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ type, params }) => {
      if (!isCommandType(type)) return fail(`Unknown command "${type}". Call kanna_commands to list them.`)
      const policy = remotePolicyOf(type)
      if (policy.kind === "excluded") return fail(`Command "${type}" cannot run remotely: ${policy.reason}`)
      const parsed = parseClientCommand({ ...(params ?? {}), type })
      if (!parsed.ok) return fail(parsed.error)
      const command = parsed.command
      if (command.type === "chat.send") {
        const guarded = await guardedChatSend(host, command)
        return guarded.ok ? acceptedReport(guarded.record, guarded.duplicateVia) : fail(guarded.message)
      }
      if (command.type === "message.enqueue") {
        const guarded = await guardedEnqueue(host, command.chatId, command.content)
        return guarded.ok ? acceptedReport(guarded.record, guarded.duplicateVia) : fail(guarded.message)
      }
      return envelopeToToolResult(await host.dispatchCommand(command))
    },
  )

  tools.registerTool(
    "kanna_read",
    {
      title: "Read a Kanna snapshot",
      description: KANNA_READ_DESCRIPTION,
      inputSchema: z.object({ topic: jsonObjectSchema.describe("A subscription topic object with a type field") }),
      annotations: { readOnlyHint: true },
    },
    ({ topic }) => {
      const parsed = parseSubscriptionTopic(topic)
      if (!parsed) return fail("Unknown or malformed topic.")
      return envelopeToToolResult(host.readSnapshot(parsed))
    },
  )
}
