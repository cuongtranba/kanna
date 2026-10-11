import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { commandResult } from "./remote-mcp-views"

const chatIdField = z.string().describe("Id of the chat")

export function registerObservabilityTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "list_workflows",
    {
      title: "List workflow runs",
      description: "List the workflow runs of a chat with their status.",
      inputSchema: { chatId: chatIdField },
      annotations: { readOnlyHint: true },
    },
    ({ chatId }) => envelopeToToolResult(host.readSnapshot({ type: "workflows", chatId })),
  )

  server.registerTool(
    "get_workflow_run",
    {
      title: "Read a workflow run",
      description: "Read the full detail of one workflow run, including its agents and phases.",
      inputSchema: { chatId: chatIdField, runId: z.string().describe("Id of the workflow run") },
      annotations: { readOnlyHint: true },
    },
    ({ chatId, runId }) => commandResult(host, { type: "workflows.getRun", chatId, runId }),
  )

  server.registerTool(
    "get_subagent_run",
    {
      title: "Read a subagent run",
      description: "Read the transcript and result of one subagent run.",
      inputSchema: { chatId: chatIdField, agentId: z.string().describe("Id of the subagent run") },
      annotations: { readOnlyHint: true },
    },
    ({ chatId, agentId }) => commandResult(host, { type: "subagents.getRun", chatId, agentId }),
  )

  server.registerTool(
    "get_background_task_output",
    {
      title: "Read background task output",
      description: "Read the captured output of a background task started by a chat.",
      inputSchema: { chatId: chatIdField, taskId: z.string().describe("Id of the background task") },
      annotations: { readOnlyHint: true },
    },
    ({ chatId, taskId }) => commandResult(host, { type: "backgroundTasks.getOutput", chatId, taskId }),
  )
}
