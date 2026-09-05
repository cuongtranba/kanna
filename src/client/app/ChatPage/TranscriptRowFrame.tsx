import { type ReactNode, memo } from "react"
import { KannaTranscriptRow, type ResolvedTranscriptRow } from "../KannaTranscript"
import { cn } from "../../lib/utils"
import { DELEGATE_SUBAGENT_TOOL_NAME } from "../subagent-run-placement"


export function delegateRunIdOf(row: ResolvedTranscriptRow): string | null {
  return row.kind === "single"
    && row.message.kind === "tool"
    && row.message.toolName === DELEGATE_SUBAGENT_TOOL_NAME
    ? row.message.toolId
    : null
}

interface TranscriptRowFrameProps {
  row: ResolvedTranscriptRow
  gapClass: string
  arriveIndex: number | undefined
  toolGroupExpanded: boolean | undefined
  runTree: ReactNode
}

function TranscriptRowFrameImpl({
  row,
  gapClass,
  arriveIndex,
  toolGroupExpanded,
  runTree,
}: TranscriptRowFrameProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[800px]",
        gapClass,
        arriveIndex !== undefined && "kanna-transcript-row-in",
      )}
      style={arriveIndex === undefined
        ? undefined
        : { animationDelay: `calc(${arriveIndex} * var(--motion-stagger-loose))` }}
      data-transcript-row-id={row.id}
    >
      <KannaTranscriptRow row={row} toolGroupExpanded={toolGroupExpanded} />
      {runTree}
    </div>
  )
}

export const TranscriptRowFrame = memo(TranscriptRowFrameImpl)
