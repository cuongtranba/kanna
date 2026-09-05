import { type ReactNode, memo } from "react"
import { KannaTranscriptRow, type ResolvedTranscriptRow } from "../KannaTranscript"
import { cn } from "../../lib/utils"
import { DELEGATE_SUBAGENT_TOOL_NAME } from "../subagent-run-placement"

/**
 * The frame every transcript row is drawn in: its reading-column width, the gap
 * above it, its arrival, and the subagent run tree that hangs beneath a
 * delegate call.
 *
 * Extracted from `ChatTranscriptViewport`'s `renderItem` because adding the
 * arrival pushed that module past the 700-line architecture budget. The budget
 * message prescribes exactly this remedy — put the new code in a module that
 * owns it — rather than raising the allowance, which would have recorded the
 * PR as making a tracked issue worse.
 */

/** The subagent run a row's delegate tool call owns, if it is one. */
export function delegateRunIdOf(row: ResolvedTranscriptRow): string | null {
  return row.kind === "single"
    && row.message.kind === "tool"
    && row.message.toolName === DELEGATE_SUBAGENT_TOOL_NAME
    ? row.message.toolId
    : null
}

interface TranscriptRowFrameProps {
  row: ResolvedTranscriptRow
  /** Spacing above this row, already resolved against its neighbour. */
  gapClass: string
  /**
   * Stagger position when this row is ARRIVING, `undefined` when it was
   * already there. Only genuinely new rows animate — anything already rendered
   * is left alone, which is what keeps scroll position and LegendList's
   * maintainVisibleContentPosition honest.
   */
  arriveIndex: number | undefined
  toolGroupExpanded: boolean | undefined
  /** The subagent run tree, when this row launched one. */
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
