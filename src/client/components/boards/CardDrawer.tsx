import { useCallback, useEffect } from "react"
import { ExternalLink, X } from "lucide-react"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { cn } from "../../lib/utils"
import { useCardDrawerStore } from "./CardDrawer.store"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import type { CardActor, FieldValue } from "../../../shared/boards/types"
import {
  startWorkLabel,
  type CardDetailView,
  type StartWorkResult,
} from "../../../shared/boards/start-work"
import { errorMessage, type AnyValue } from "../../../shared/errors"

/**
 * Card detail, as a drawer INSIDE the board pane.
 *
 * Not a modal: the board is the thing the reader is reasoning about, and a
 * modal would hide it. The drawer overlays the rightmost columns so the card
 * keeps its spatial context; below ~720px it takes the pane, because a 400px
 * drawer on a pane split beside a chat leaves nothing readable on either side.
 */

export interface CardDrawerSocket {
  command<TResult = AnyValue>(command: AnyValue): Promise<TResult>
}

export interface CardDrawerProps {
  cardId: string
  socket: CardDrawerSocket
  onClose: () => void
  /** Re-read after a write; the board's own snapshot arrives separately. */
  onChanged?: () => void
}

function textOf(value: FieldValue | undefined): string | null {
  if (!value) return null
  if (value.kind === "text" || value.kind === "longtext" || value.kind === "url") {
    return value.value.trim() === "" ? null : value.value
  }
  return null
}

/** Who wrote a comment, in the reader's terms rather than the store's. */
function authorLabel(kind: CardActor["kind"]): string {
  switch (kind) {
    case "agent":
      return "Agent"
    case "sync":
      return "Sync"
    case "user":
      return "You"
  }
}

function labelsOf(value: FieldValue | undefined): string[] {
  if (value?.kind === "label") return [...value.values]
  return []
}

/**
 * What to say after the button has run.
 *
 * Only the surprising outcomes get a line. Opening the chat is its own
 * feedback — the tab appears — and saying "Started" over it would be the UI
 * performing rather than explaining.
 */
function describeStartWork(result: StartWorkResult): string | null {
  if (result.reused) return null
  if (result.movedToColumnId === null) return "Started · no column marked active"
  return null
}

export function CardDrawer({ cardId, socket, onClose, onChanged }: CardDrawerProps) {
  const detail = useCardDrawerStore((state) => state.detail)
  const error = useCardDrawerStore((state) => state.error)
  const draft = useCardDrawerStore((state) => state.draft)
  const { setDetail, setError, setDraft, reset } = useCardDrawerStore.getState()

  const load = useCallback(() => {
    void socket
      .command<CardDetailView | null>({ type: "board.card.detail", cardId })
      .then(setDetail)
      .catch((cause: AnyValue) => {
        setError(errorMessage(cause))
      })
  }, [cardId, setDetail, setError, socket])

  useEffect(() => {
    reset()
    load()
  }, [load, reset])

  const handleComment = useCallback(() => {
    const body = useCardDrawerStore.getState().draft.trim()
    if (body === "") return
    setDraft("")
    void socket
      .command({ type: "board.card.comment", cardId, body })
      .then(() => {
        load()
        onChanged?.()
      })
      .catch((cause: AnyValue) => {
        setError(errorMessage(cause))
      })
  }, [cardId, load, onChanged, setDraft, setError, socket])

  const handleArchive = useCallback(() => {
    void socket
      .command({ type: "board.card.archive", cardId })
      .then(() => {
        onChanged?.()
        onClose()
      })
      .catch((cause: AnyValue) => {
        setError(errorMessage(cause))
      })
  }, [cardId, onChanged, onClose, setError, socket])

  /**
   * One action, whatever state the card is in. The server re-derives that state
   * from the same resolver the label came from, so a stale label costs a
   * round-trip and never the wrong outcome.
   */
  const handleStartWork = useCallback(() => {
    useCardDrawerStore.getState().beginStartWork()
    void socket
      .command<StartWorkResult>({ type: "board.card.startWork", cardId })
      .then((result) => {
        usePaneLayoutStore.getState().openTab({ kind: "chat", chatId: result.chatId })
        useCardDrawerStore.getState().endStartWork(describeStartWork(result))
        load()
        onChanged?.()
      })
      .catch((cause: AnyValue) => {
        useCardDrawerStore.getState().endStartWork(null)
        setError(errorMessage(cause))
      })
  }, [cardId, load, onChanged, setError, socket])

  const handleDraft = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(event.currentTarget.value)
    },
    [setDraft],
  )

  const startingWork = useCardDrawerStore((state) => state.startingWork)
  const startWorkNote = useCardDrawerStore((state) => state.startWorkNote)

  const card = detail?.card ?? null
  const startWork = detail?.startWork ?? null
  const description = card ? textOf(card.content.description) : null
  const externalUrl = card ? textOf(card.content.externalUrl) : null
  const labels = card ? labelsOf(card.content.labels) : []
  const assignee = card ? textOf(card.content.assignee) : null

  return (
    <aside
      className={cn(
        // Overlays the columns rather than pushing them: the board must stay
        // where the reader left it.
        "absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background",
        "sm:w-[400px]",
      )}
      aria-label="Card detail"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground [text-wrap:pretty]">
          {card?.title ?? "Loading…"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-4" />
        </button>
      </header>

      {error ? <p className="px-4 py-2 text-[13px] text-destructive-text">{error}</p> : null}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {startWork ? (
          <section className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleStartWork}
                disabled={startingWork || startWork.blockedReason !== null}
              >
                {startingWork ? "Starting…" : startWorkLabel(startWork.status)}
              </Button>
              {/* Derived, never asked — so it is shown, not offered as a field. */}
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {startWork.branch}
              </span>
            </div>
            {startWork.blockedReason ? (
              <p className="text-[13px] text-muted-foreground">{startWork.blockedReason}</p>
            ) : null}
            {startWorkNote ? <p className="text-[13px] text-muted-foreground">{startWorkNote}</p> : null}
          </section>
        ) : null}

        {description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground [text-wrap:pretty]">
            {description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No description.</p>
        )}

        {labels.length > 0 || assignee || externalUrl ? (
          <dl className="space-y-2 text-[13px]">
            {labels.length > 0 ? (
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted-foreground">Labels</dt>
                <dd className="text-foreground">{labels.join(", ")}</dd>
              </div>
            ) : null}
            {assignee ? (
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted-foreground">Assignee</dt>
                <dd className="text-foreground">{assignee}</dd>
              </div>
            ) : null}
            {externalUrl ? (
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted-foreground">Source</dt>
                <dd className="min-w-0">
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 truncate text-info hover:underline"
                  >
                    <span className="truncate">{externalUrl.replace(/^https:\/\//, "")}</span>
                    <ExternalLink aria-hidden className="size-3 shrink-0" />
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Comments</h3>
          {detail && detail.comments.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Nothing recorded yet.</p>
          ) : null}
          <ul className="space-y-3">
            {(detail?.comments ?? []).map((comment) => (
              <li key={comment.id} className="border-b border-border pb-3 last:border-b-0">
                <p className="text-xs text-muted-foreground">{authorLabel(comment.author.kind)}</p>
                <p className="whitespace-pre-wrap text-[13px] text-foreground">{comment.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="space-y-2 border-t border-border px-4 py-3">
        <Textarea
          value={draft}
          onChange={handleDraft}
          rows={2}
          placeholder="Record what you did…"
          aria-label="New comment"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleComment} disabled={draft.trim() === ""}>
            Comment
          </Button>
          <Button variant="ghost" size="sm" className="ml-auto text-destructive-text" onClick={handleArchive}>
            Archive
          </Button>
        </div>
      </footer>
    </aside>
  )
}
