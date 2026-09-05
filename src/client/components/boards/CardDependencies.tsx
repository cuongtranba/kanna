import { useCallback, useMemo } from "react"
import { Check, X } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { cn } from "../../lib/utils"
import type { CardBlocker } from "../../../shared/boards/dependencies"
import { onRejected } from "../../../shared/errors"
import type { JsonValue } from "../../../shared/json"
import type { ClientCommand } from "../../../shared/protocol"


export interface CardDependenciesSocket {
  command<TResult = JsonValue>(command: ClientCommand): Promise<TResult>
}

export interface BlockerCandidate {
  id: string
  title: string
}

export interface CardDependenciesProps {
  cardId: string
  blockers: readonly CardBlocker[]
  candidates: readonly BlockerCandidate[]
  socket: CardDependenciesSocket
  onChanged: () => void
  onError: (message: string) => void
}

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
        .catch(onRejected((error) => {
          onError(error.message)
        }))
    },
    [cardId, onChanged, onError, socket],
  )

  const handleRemove = useCallback(
    (blockedByCardId: string) => {
      void socket
        .command({ type: "board.card.unblock", cardId, blockedByCardId })
        .then(onChanged)
        .catch(onRejected((error) => {
          onError(error.message)
        }))
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
