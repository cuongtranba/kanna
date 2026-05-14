import type { HydratedTranscriptMessage } from "../../../shared/types"
import { TextMessage } from "./TextMessage"
import { ToolCallMessage } from "./ToolCallMessage"
import { ResultMessage } from "./ResultMessage"

interface SubagentEntryRowProps {
  message: HydratedTranscriptMessage
  localPath: string
}

export function SubagentEntryRow({ message, localPath }: SubagentEntryRowProps) {
  switch (message.kind) {
    case "assistant_text":
      return <TextMessage message={message} />
    case "tool":
      return <ToolCallMessage message={message} isLoading={false} localPath={localPath} />
    case "result":
      return <ResultMessage message={message} />
    default:
      return null
  }
}
