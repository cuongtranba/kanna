import type { ContextWindowUsageSnapshot } from "../shared/types"
import type { JsonValue } from "../shared/json"
import type {
  CodexRequestId,
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
  TurnPlanStep,
} from "./codex-app-server-protocol"
import type { HarnessEvent, HarnessToolRequest } from "./harness-types"
import type { AsyncQueue } from "./async-queue"

export interface PendingTurn {
  turnId: string | null
  model: string
  planMode: boolean
  queue: AsyncQueue<HarnessEvent>
  startedToolIds: Set<string>
  handledDynamicToolIds: Set<string>
  latestPlanExplanation: string | null
  latestPlanSteps: TurnPlanStep[]
  latestPlanText: string | null
  planTextByItemId: Map<string, string>
  todoSequence: number
  pendingWebSearchResultToolId: string | null
  lastUsageSnapshot?: ContextWindowUsageSnapshot
  onToolRequest: (request: HarnessToolRequest) => Promise<JsonValue>
  onApprovalRequest?: (
    request:
      | {
          requestId: CodexRequestId
          kind: "command_execution"
          params: CommandExecutionRequestApprovalParams
        }
      | {
          requestId: CodexRequestId
          kind: "file_change"
          params: FileChangeRequestApprovalParams
        }
  ) => Promise<CommandExecutionApprovalDecision | FileChangeApprovalDecision>
}
