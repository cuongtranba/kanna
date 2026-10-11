import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { commandResult } from "./remote-mcp-views"

const chatIdField = z.string().describe("Id of the chat that owns the cron job")
const jobIdField = z.string().describe("Id of the cron job")

export function registerCronTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "list_cron_jobs",
    {
      title: "List cron jobs",
      description: "List every cron job across all projects with its schedule, state and next fire time.",
      annotations: { readOnlyHint: true },
    },
    () => envelopeToToolResult(host.readSnapshot({ type: "cron-jobs" })),
  )

  server.registerTool(
    "pause_cron_job",
    {
      title: "Pause a cron job",
      description: "Pause a cron job so it stops firing until resumed.",
      inputSchema: { chatId: chatIdField, jobId: jobIdField },
    },
    ({ chatId, jobId }) => commandResult(host, { type: "cron.pause", chatId, jobId }),
  )

  server.registerTool(
    "resume_cron_job",
    {
      title: "Resume a cron job",
      description: "Resume a paused cron job.",
      inputSchema: { chatId: chatIdField, jobId: jobIdField },
    },
    ({ chatId, jobId }) => commandResult(host, { type: "cron.resume", chatId, jobId }),
  )

  server.registerTool(
    "remove_cron_job",
    {
      title: "Remove a cron job",
      description: "Permanently remove a cron job and its schedule. Its past run records stay in the chat transcript.",
      inputSchema: { chatId: chatIdField, jobId: jobIdField },
      annotations: { destructiveHint: true },
    },
    ({ chatId, jobId }) => commandResult(host, { type: "cron.remove", chatId, jobId }),
  )
}
