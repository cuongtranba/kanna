import { z } from "zod"
import { APP_VERSION } from "../../shared/branding"
import { DEFAULT_WAIT_SECONDS, MS_PER_SECOND, SILENT_WAIT_CAP_SECONDS } from "./remote-mcp-follow-view"
import { envelopeToToolResult } from "./remote-mcp-views"
import { mcpOnlyTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"
import { jsonResult } from "./remote-mcp-views"

export const systemTools: readonly RemoteTool[] = [
  topicTool({
    name: "get_update_status",
    title: "Update status",
    description: "Read whether a newer Kanna version is available and the state of any update in progress.",
    annotations: { readOnlyHint: true },
    topic: "update",
    input: z.object({}),
    handle: (_args, { host }) => envelopeToToolResult(host.readSnapshot({ type: "update" })),
  }),
  mcpOnlyTool({
    name: "server_info",
    title: "Server info",
    description: "Report the Kanna version, the machine name and the public origin this MCP server is reached at.",
    annotations: { readOnlyHint: true },
    reason: "Describes this MCP endpoint (version, machine name, public origin); no command or topic carries it.",
    input: z.object({}),
    handle: (_args, { host }) => jsonResult({ version: APP_VERSION, machineName: host.machineName, publicOrigin: host.publicOrigin() }),
  }),
  mcpOnlyTool({
    name: "wait_for_events",
    title: "Wait for events",
    description:
      "Long-poll Kanna's event feed: turns started, finished, failed or cancelled, chats created, approvals and questions that became pending or were resolved, and cron runs. "
      + "Returns { cursor, reset, dropped, events }; each event is { seq, envelope } and envelope.subject says what happened. Pass the returned cursor as `after` to receive only newer events. "
      + "Omit `after` to wait for the next event from now. reset true means the cursor was unknown (Kanna restarted), so re-read state with get_chat or list_chats; dropped counts events lost before you read them. "
      + "Clients that can listen on the kanna://events resource get the same events pushed without polling.",
    annotations: { readOnlyHint: true },
    reason: "Reads the in-memory remote MCP event feed, which only this endpoint keeps; it is the polling twin of the kanna://events resource for clients that cannot listen.",
    input: z.object({
      after: z.string().optional().describe("The cursor returned by wait_for_events or the kanna://events resource. Omit to wait for the next event from now"),
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(SILENT_WAIT_CAP_SECONDS)
        .optional()
        .describe(`Longest wait in seconds (default ${DEFAULT_WAIT_SECONDS}, max ${SILENT_WAIT_CAP_SECONDS})`),
    }),
    handle: async ({ after, timeoutSeconds }, { host }) =>
      jsonResult(await host.eventFeed.waitFor(after ?? null, (timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * MS_PER_SECOND)),
  }),
]
