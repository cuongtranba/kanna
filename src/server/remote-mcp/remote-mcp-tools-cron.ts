import { z } from "zod"
import { envelopeToToolResult } from "./remote-mcp-views"
import { commandTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"

export const cronTools: readonly RemoteTool[] = [
  topicTool({
    name: "list_cron_jobs",
    title: "List cron jobs",
    description: "List every cron job across all projects with its schedule, state and next fire time.",
    annotations: { readOnlyHint: true },
    topic: "cron-jobs",
    input: z.object({}),
    handle: (_args, { host }) => envelopeToToolResult(host.readSnapshot({ type: "cron-jobs" })),
  }),
  commandTool({
    name: "pause_cron_job",
    title: "Pause a cron job",
    description: "Pause a cron job so it stops firing until resumed.",
    command: "cron.pause",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "cron.pause", ...args }),
  }),
  commandTool({
    name: "resume_cron_job",
    title: "Resume a cron job",
    description: "Resume a paused cron job.",
    command: "cron.resume",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "cron.resume", ...args }),
  }),
  commandTool({
    name: "remove_cron_job",
    title: "Remove a cron job",
    description: "Permanently remove a cron job and its schedule. Its past run records stay in the chat transcript.",
    annotations: { destructiveHint: true },
    command: "cron.remove",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "cron.remove", ...args }),
  }),
]
