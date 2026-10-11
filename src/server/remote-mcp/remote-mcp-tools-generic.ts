import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { jsonObjectSchema } from "../../shared/genui/json-schema"
import {
  COMMAND_CATALOG,
  isCatalogedCommandType,
  listCommandCatalog,
  toClientCommand,
} from "../../shared/remote-mcp/command-catalog"
import { parseSubscriptionTopic } from "../../shared/remote-mcp/topics"
import { fail, ok } from "../kanna-mcp-tool"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import type { RemoteMcpHost } from "./remote-mcp-server"

const KANNA_COMMANDS_DESCRIPTION =
  "List every Kanna command kanna_command can run, with its parameters and risk."
const KANNA_COMMAND_DESCRIPTION =
  "Run one Kanna command (the same operations the web UI performs) by its dotted type, for example chat.send or board.card.move. "
  + "Call kanna_commands first to see each command's parameters and risk; destructive commands delete or discard data, local commands act on the host machine."
const KANNA_READ_DESCRIPTION =
  "Read the current snapshot of one subscription topic, for example {\"type\":\"sidebar\"} or {\"type\":\"chat\",\"chatId\":\"...\"}."

export function registerGenericTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Liveness check; answers pong.",
      annotations: { readOnlyHint: true },
    },
    () => ok("pong"),
  )

  server.registerTool(
    "kanna_commands",
    {
      title: "List Kanna commands",
      description: KANNA_COMMANDS_DESCRIPTION,
      inputSchema: { domain: z.string().optional().describe("Only commands in this domain, such as chat or board") },
      annotations: { readOnlyHint: true },
    },
    ({ domain }) => ok(JSON.stringify(listCommandCatalog(domain))),
  )

  server.registerTool(
    "kanna_command",
    {
      title: "Run a Kanna command",
      description: KANNA_COMMAND_DESCRIPTION,
      inputSchema: {
        type: z.string().describe("Dotted command type, such as chat.rename"),
        params: jsonObjectSchema.optional().describe("The command's parameters as an object"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ type, params }) => {
      if (!isCatalogedCommandType(type)) return fail(`Unknown command "${type}". Call kanna_commands to list them.`)
      if (COMMAND_CATALOG[type].risk === "unavailable") {
        return fail(`Command "${type}" is bound to a browser or socket and cannot run remotely.`)
      }
      const command = toClientCommand(type, params ?? {})
      if (!command) return fail(`Command "${type}" could not be built from the given params.`)
      return envelopeToToolResult(await host.dispatchCommand(command))
    },
  )

  server.registerTool(
    "kanna_read",
    {
      title: "Read a Kanna snapshot",
      description: KANNA_READ_DESCRIPTION,
      inputSchema: { topic: jsonObjectSchema.describe("A subscription topic object with a type field") },
      annotations: { readOnlyHint: true },
    },
    ({ topic }) => {
      const parsed = parseSubscriptionTopic(topic)
      if (!parsed) return fail("Unknown or malformed topic.")
      return envelopeToToolResult(host.readSnapshot(parsed))
    },
  )
}
