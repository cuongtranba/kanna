import { useCallback, useMemo } from "react"
import { Check, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { cn } from "../../lib/utils"
import type { CardBlocker } from "../../../shared/boards/dependencies"
import { errorMessage, type AnyValue } from "../../../shared/errors"

/**
 * "Blocked by" — the card's ordering edges, and the gesture that authors them.
 *
 * The user-facing half of adr-20260904-cross-project-orchestration. It lives in
 * its own module rather than inside `CardDrawer.tsx` because that file sits at
 * its architecture-budget pin, and because this is a self-contained concern:
 * it owns its two commands and reports outcomes back to the drawer rather than
 * reaching into its store.
 *
 * A gesture is the point. `c3-232 orchestration-core` was retired for being
 * unreachable from anything a user does (adr-20260802), so an ordering feature
 * with only a server-side edge would repeat exactly that mistake.
 */

export interface CardDependenciesSocket {
  command<TResult = AnyValue>(command: AnyValue): Promise<TResult>
}

/** A card that may be waited on: everything the picker needs and nothing more. */
export interface BlockerCandidate {
  id: string
  title: string
}

export interface CardDependenciesProps {
  cardId: string
  blockers: readonly CardBlocker[]
  /**
   * The cards this one could wait on — the board's LOADED pages, prop-drilled
   * from the board view for the same reason `cardFields` is. A board with more
   * cards than one page per column offers what is on screen; the alternative is
   * a search endpoint, which is its own change.
   */
  candidates: readonly BlockerCandidate[]
  socket: CardDependenciesSocket
  /** Re-read the card after a write. */
  onChanged: () => void
  onError: (message: string) => void
}

/**
 * The trigger reads "Add a blocker…" at all times, so it is a menu rather than
 * a field with a value. Same sentinel trick as `SelectFieldValue`'s
 * `CLEAR_SELECTION`: a value no card id can collide with, because every real
 * option is prefixed.
 */
const NO_SELECTION = "add"

function candidateValue(cardId: string): string {
  return `c:${cardId}`
}

export function CardDependencies({
  cardId,
  blockers,
  candidates,
  socket,
  onChanged,
  onError,
}: CardDependenciesProps) {
  const blocked = useMemo(() => new Set(blockers.map((entry) => entry.cardId)), [blockers])

  // A card cannot wait on itself, and offering an edge that already exists
  // would report "already blocked" as an error the user could have been spared.
  const offered = useMemo(
    () => candidates.filter((entry) => entry.id !== cardId && !blocked.has(entry.id)),
    [blocked, cardId, candidates],
  )

  const handleAdd = useCallback(
    (chosen: string) => {
      if (chosen === NO_SELECTION) return
      void socket
        .command({ type: "board.card.block", cardId, blockedByCardId: chosen.slice(2) })
        .then(onChanged)
        .catch((cause: AnyValue) => {
          // The server refuses a cycle by naming the cards in it, so this is
          // the whole explanation the user needs.
          onError(errorMessage(cause))
        })
    },
    [cardId, onChanged, onError, socket],
  )

  const handleRemove = useCallback(
    (blockedByCardId: string) => {
      void socket
        .command({ type: "board.card.unblock", cardId, blockedByCardId })
        .then(onChanged)
        .catch((cause: AnyValue) => {
          onError(errorMessage(cause))
        })
    },
    [cardId, onChanged, onError, socket],
  )

  if (blockers.length === 0 && offered.length === 0) return null

  return (
    <section>
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Blocked by</h3>
      {blockers.length > 0 ? (
        <ul className="mb-2 space-y-0.5">
          {blockers.map((blocker) => (
            <BlockerRow key={blocker.cardId} blocker={blocker} onRemove={handleRemove} />
          ))}
        </ul>
      ) : null}
      {offered.length > 0 ? (
        <Select value={NO_SELECTION} onValueChange={handleAdd}>
          <SelectTrigger aria-label="Add a blocker" className="h-8 px-2 text-13">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELECTION}>Add a blocker…</SelectItem>
            {offered.map((candidate) => (
              <SelectItem key={candidate.id} value={candidateValue(candidate.id)}>
                {candidate.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </section>
  )
}

/**
 * One edge.
 *
 * A cleared blocker stays listed rather than disappearing: what a card waited
 * on is part of reading it, and a row that vanished on completion would make
 * the card's history depend on when you happened to look. Cleared is carried by
 * a check plus muted, struck text — never by colour alone.
 */
function BlockerRow({
  blocker,
  onRemove,
}: {
  blocker: CardBlocker
  onRemove: (cardId: string) => void
}) {
  const handleClick = useCallback(() => {
    onRemove(blocker.cardId)
  }, [blocker.cardId, onRemove])

  return (
    <li className="flex items-center gap-1.5">
      {blocker.cleared ? (
        <Check aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-13",
          blocker.cleared ? "text-muted-foreground line-through" : "text-foreground",
        )}
      >
        {blocker.title}
      </span>
      <span className="sr-only">{blocker.cleared ? "Done" : "Not done"}</span>
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Stop waiting on ${blocker.title}`}
        className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
      >
        <X aria-hidden className="size-3" />
      </button>
    </li>
  )
}
