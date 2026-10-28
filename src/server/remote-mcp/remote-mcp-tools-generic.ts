import { z } from "zod"
import { jsonObjectSchema } from "../../shared/genui/json-schema"
import { isCommandType, listCommandDescriptors, parseClientCommand, remotePolicyOf } from "../../shared/commands"
import { parseSubscriptionTopic } from "../../shared/remote-mcp/topics"
import { fail, ok } from "../kanna-mcp-tool"
import { envelopeToToolResult } from "./remote-mcp-views"
import { acceptedReport, guardedChatSend, guardedEnqueue } from "./remote-mcp-follow"
import { IDEMPOTENCY_KEY_FIELD } from "./remote-mcp-tool-fields"
import { mcpOnlyTool, type RemoteTool } from "./remote-mcp-tool-spec"

const KANNA_COMMANDS_DESCRIPTION =
  "List every Kanna command with its domain, summary, risk, whether it can run remotely (with the reason when it cannot), a JSON Schema of its params and, for commands that declare one, a JSON Schema of the result it returns."
const KANNA_COMMAND_DESCRIPTION =
  "Run one Kanna command (the same operations the web UI performs) by its dotted type, for example chat.rename or board.card.move. "
  + "Call kanna_commands first to see each command's params (JSON Schema), result (JSON Schema, when declared) and risk; destructive commands delete or discard data, local commands act on the host machine. "
  + "Prefer send_message over chat.send: kanna_command returns as soon as the message is accepted and does not wait, and an identical chat.send or message.enqueue "
  + "to a chat that is already working on it is suppressed as a duplicate, and an idempotencyKey makes a repeated chat.send or message.enqueue return the original chat. Follow a chat with wait_for_chat."
const KANNA_READ_DESCRIPTION =
  "Read the current snapshot of one subscription topic, for example {\"type\":\"sidebar\"} or {\"type\":\"chat\",\"chatId\":\"...\"}."

export const genericTools: readonly RemoteTool[] = [
  mcpOnlyTool({
    name: "ping",
    title: "Ping",
    description: "Liveness check; answers pong.",
    annotations: { readOnlyHint: true },
    reason: "Answers from the MCP server itself; the WebSocket system.ping command is a browser keepalive.",
    input: z.object({}),
    handle: () => ok("pong"),
  }),
  mcpOnlyTool({
    name: "kanna_commands",
    title: "List Kanna commands",
    description: KANNA_COMMANDS_DESCRIPTION,
    annotations: { readOnlyHint: true },
    reason: "Publishes the command registry itself, so it has no command of its own.",
    input: z.object({ domain: z.string().optional().describe("Only commands in this domain, such as chat or board") }),
    handle: ({ domain }) => ok(JSON.stringify(listCommandDescriptors(domain))),
  }),
  mcpOnlyTool({
    name: "kanna_command",
    title: "Run a Kanna command",
    description: KANNA_COMMAND_DESCRIPTION,
    annotations: { destructiveHint: true },
    reason: "Generic dispatcher for every remote-allowed registry command; it validates with parseClientCommand.",
    input: z.object({
      type: z.string().describe("Dotted command type, such as chat.rename"),
      params: jsonObjectSchema.optional().describe("The command's parameters as an object"),
      idempotencyKey: IDEMPOTENCY_KEY_FIELD,
    }),
    handle: async ({ type, params, idempotencyKey }, { host }) => {
      if (!isCommandType(type)) return fail(`Unknown command "${type}". Call kanna_commands to list them.`)
      const policy = remotePolicyOf(type)
      if (policy.kind === "excluded") return fail(`Command "${type}" cannot run remotely: ${policy.reason}`)
      const parsed = parseClientCommand({ ...(params ?? {}), type })
      if (!parsed.ok) return fail(parsed.error)
      const command = parsed.command
      if (command.type === "chat.send") {
        const guarded = await guardedChatSend(host, command, idempotencyKey)
        return guarded.ok ? acceptedReport(guarded.record, guarded.duplicateVia) : fail(guarded.message)
      }
      if (command.type === "message.enqueue") {
        const guarded = await guardedEnqueue(host, command, idempotencyKey)
        return guarded.ok ? acceptedReport(guarded.record, guarded.duplicateVia) : fail(guarded.message)
      }
      return envelopeToToolResult(await host.dispatchCommand(command))
    },
  }),
  mcpOnlyTool({
    name: "kanna_read",
    title: "Read a Kanna snapshot",
    description: KANNA_READ_DESCRIPTION,
    annotations: { readOnlyHint: true },
    reason: "Generic reader for every subscription topic; each topic is validated by parseSubscriptionTopic.",
    input: z.object({ topic: jsonObjectSchema.describe("A subscription topic object with a type field") }),
    handle: async ({ topic }, { host }) => {
      const parsed = parseSubscriptionTopic(topic)
      if (!parsed) return fail("Unknown or malformed topic.")
      if (parsed.type === "local-projects") await host.refreshLocalProjects()
      return envelopeToToolResult(host.readSnapshot(parsed))
    },
  }),
]
