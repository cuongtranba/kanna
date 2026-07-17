/**
 * agent.ts — public barrel for the AgentCoordinator and its utility re-exports.
 *
 * The AgentCoordinator class lives in agent-coordinator.ts. This file exists
 * so that all existing callers importing from "./agent" continue to work
 * without changes — re-exporting the class and the utility symbols that
 * external modules expect from this path.
 */

// Primary export: the coordinator class
export { AgentCoordinator } from "./agent-coordinator"

// Utility re-exports expected from this path by external callers
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
