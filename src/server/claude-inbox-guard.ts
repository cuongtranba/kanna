import type { HookCallbackMatcher, HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk"
import { inboxHandlerTurnKind } from "../shared/inbound/handler-turn"
import type { McpServerConfig } from "../shared/mcp-types"
import type { McpSource } from "../shared/mcp-sources/types"
import { mcpToolName, SEND_CHAT_MESSAGE_TOOL_NAME } from "../shared/tools"

export interface InboxToolPolicy {
  replyServerNames: readonly string[]
}

export const INBOX_HANDLER_TOOL_DENIED_MESSAGE =
  "Inbox handler turns cannot send, message other chats or run shell commands. Report with inbox_report; to reply, use propose_send and Kanna will decide."

const BASH_TOOL = "Bash"

function normalizedServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_")
}

export function inboxToolPolicyOf(
  scheduleId: string | undefined,
  sources: readonly Pick<McpSource, "serverId" | "reply">[],
  servers: readonly Pick<McpServerConfig, "id" | "name">[],
): InboxToolPolicy | null {
  const kind = inboxHandlerTurnKind(scheduleId)
  if (kind !== "triage" && kind !== "ask") return null
  const replyServerIds = new Set(sources.filter((source) => source.reply !== null).map((source) => source.serverId))
  return { replyServerNames: servers.filter((server) => replyServerIds.has(server.id)).map((server) => server.name) }
}

function isDeniedTool(toolName: string, policy: InboxToolPolicy): boolean {
  if (toolName === BASH_TOOL || toolName === SEND_CHAT_MESSAGE_TOOL_NAME) return true
  return policy.replyServerNames.some((name) =>
    toolName.startsWith(mcpToolName(name, "")) || toolName.startsWith(mcpToolName(normalizedServerName(name), "")),
  )
}

export function buildInboxGuardMatcher(policyOf: () => InboxToolPolicy | null): HookCallbackMatcher {
  const guard = async (input: HookInput): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PreToolUse") return {}
    const policy = policyOf()
    if (policy === null || !isDeniedTool(input.tool_name, policy)) return {}
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: INBOX_HANDLER_TOOL_DENIED_MESSAGE,
      },
    }
  }
  return { hooks: [guard] }
}
