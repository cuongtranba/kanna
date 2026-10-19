import type { ToolRegistrar } from "./remote-mcp-tool-registrar"
import { z } from "zod"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { commandResult } from "./remote-mcp-views"

const chatIdField = z.string().describe("Id of the chat that owns the cron job")
const jobIdField = z.string().describe("Id of the cron job")

export function registerCronTools(tools: ToolRegistrar, host: RemoteMcpHost): void {
  tools.registerTool(
    "list_cron_jobs",
    {
      title: "List cron jobs",
      inputSchema: z.object({}),
      description: "List every cron job across all projects with its schedule, state and next fire time.",
      annotations: { readOnlyHint: true },
    },
    () => envelopeToToolResult(host.readSnapshot({ type: "cron-jobs" })),
  )

  tools.registerTool(
    "pause_cron_job",
    {
      title: "Pause a cron job",
      description: "Pause a cron job so it stops firing until resumed.",
      inputSchema: z.object({ chatId: chatIdField, jobId: jobIdField }),
    },
    ({ chatId, jobId }) => commandResult(host, { type: "cron.pause", chatId, jobId }),
  )

  tools.registerTool(
    "resume_cron_job",
    {
      title: "Resume a cron job",
      description: "Resume a paused cron job.",
      inputSchema: z.object({ chatId: chatIdField, jobId: jobIdField }),
    },
    ({ chatId, jobId }) => commandResult(host, { type: "cron.resume", chatId, jobId }),
  )

  tools.registerTool(
    "remove_cron_job",
    {
      title: "Remove a cron job",
      description: "Permanently remove a cron job and its schedule. Its past run records stay in the chat transcript.",
      inputSchema: z.object({ chatId: chatIdField, jobId: jobIdField }),
      annotations: { destructiveHint: true },
    },
    ({ chatId, jobId }) => commandResult(host, { type: "cron.remove", chatId, jobId }),
  )
}
