export type {
  AccountInfo,
  AskUserQuestionItem,
  AskUserQuestionOption,
  HydratedTranscriptMessage,
  HydratedToolCall as ProcessedToolCall,
} from "../../../shared/types"

export type ProcessedTextMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "assistant_text" }
>

export type ProcessedThinkingMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "assistant_thinking" }
>

export type ProcessedApiErrorMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "api_error" }
>

export type ProcessedPolicyRefusalMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "policy_refusal" }
>

export type ProcessedSystemMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "system_init" }
>

export type ProcessedAccountInfoMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "account_info" }
>

export type ProcessedResultMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "result" }
>

export type ProcessedCompactBoundaryMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "compact_boundary" }
>

export type ProcessedCompactSummaryMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "compact_summary" }
>

export type ProcessedContextClearedMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "context_cleared" }
>

export type ProcessedStatusMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "status" }
>

export type ProcessedInterruptedMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "interrupted" }
>

export type ProcessedMemoryLoadedMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "memory_loaded" }
>

export type ProcessedCronArmedMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "cron_armed" }
>

export type ProcessedCronCommandErrorMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "cron_command_error" }
>

export type ProcessedCronRunMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "cron_run" }
>

export type ProcessedCronRunSkippedMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "cron_run_skipped" }
>

export type ProcessedCronListMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "cron_list" }
>

export type ProcessedCronJobChangeMessage = Extract<
  import("../../../shared/types").HydratedTranscriptMessage,
  { kind: "cron_job_change" }
>
