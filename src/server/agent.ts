
export { AgentCoordinator } from "./agent-coordinator"

export { LOOP_BLOCKED_NATIVE_TOOLS, buildCanUseTool, buildClaudeEnv } from "./claude-spawn-helpers"
export type { BuildCanUseToolArgs } from "./claude-spawn-helpers"

export { timestamped, getClaudeAssistantMessageUsageId, normalizeClaudeStreamMessage } from "./claude-message-normalizer"
export type { ClaudeRawSdkMessage } from "./claude-message-normalizer"

export {
  normalizeClaudeUsageSnapshot,
  resolveFinalTurnUsage,
  maxClaudeContextWindowFromModelUsage,
  parseConfiguredContextWindowFromModelId,
} from "./claude-usage-math"

export { createClaudeHarnessStream } from "./claude-harness-stream"

export {
  buildUserMcpServers,
  buildTaskNotification,
  resolveSpawnPaths,
  resolveStackProjects,
  resolveProjectInstructions,
  CLAUDE_TOOLSET,
} from "./claude-session-config"

export {
  buildAttachmentHintText,
  buildPromptText,
  toSdkEffort,
  backgroundTaskIdsFromToolResult,
} from "./claude-prompt-helpers"

export type { ClaudeSessionHandle } from "./harness-types"

export { OAuthPoolUnavailableError } from "./oauth-errors"
