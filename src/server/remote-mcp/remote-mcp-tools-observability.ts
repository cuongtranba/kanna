import { z } from "zod"
import { envelopeToToolResult } from "./remote-mcp-envelope"
import { commandTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"

export const observabilityTools: readonly RemoteTool[] = [
  topicTool({
    name: "list_workflows",
    title: "List workflow runs",
    description: "List the workflow runs of a chat with their status.",
    annotations: { readOnlyHint: true },
    topic: "workflows",
    input: z.object({ chatId: z.string().describe("Id of the chat") }),
    handle: ({ chatId }, { host }) => envelopeToToolResult(host.readSnapshot({ type: "workflows", chatId })),
  }),
  commandTool({
    name: "get_workflow_run",
    title: "Read a workflow run",
    description: "Read the full detail of one workflow run, including its agents and phases.",
    annotations: { readOnlyHint: true },
    command: "workflows.getRun",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "workflows.getRun", ...args }),
  }),
  commandTool({
    name: "get_subagent_run",
    title: "Read a subagent run",
    description: "Read the transcript and result of one subagent run.",
    annotations: { readOnlyHint: true },
    command: "subagents.getRun",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "subagents.getRun", ...args }),
  }),
  commandTool({
    name: "get_background_task_output",
    title: "Read background task output",
    description: "Read the captured output of a background task started by a chat.",
    annotations: { readOnlyHint: true },
    command: "backgroundTasks.getOutput",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "backgroundTasks.getOutput", ...args }),
  }),
]
