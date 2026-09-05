import { useCallback, useEffect } from "react"
import { ExternalLink, Pencil, X } from "lucide-react"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select"
import { cn } from "../../lib/utils"
import { useCardDrawerStore } from "./CardDrawer.store"
import { CardDependencies, type BlockerCandidate } from "./CardDependencies"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { chatDotBgClass, chatStatusIndicator } from "../../lib/chatStatusIndicator"
import { statusLabel } from "../../lib/statusLabel"
import { NO_BOARD_CHAT_FACTS, type BoardChatFacts } from "../../lib/boards/boardChatFacts"
import { COLUMN_DOT_CLASS } from "../../lib/boards/columnStyle"
import { authorLabel, describeStartWork, workDetailRows } from "../../lib/boards/cardDrawerText"
import {
  fieldDisplayText,
  fieldDraftText,
  nextCardContent,
  optionsOf,
  parseFieldDraft,
  selectedOptionId,
  selectedOptionIds,
  toggledOptionIds,
} from "../../lib/boards/cardFieldValue"
import type {
  CardContent,
  CardLink,
  ColumnColorToken,
  FieldDef,
  FieldValue,
} from "../../../shared/boards/types"
import { startWorkLabel, type CardDetailView, type StartWorkResult } from "../../../shared/boards/start-work"
import {
  describeWorktreeContents,
  discardBlockedReason,
  mergeBlockedReason,
  type CleanupDecision,
} from "../../../shared/boards/worktree-cleanup"
import type { CardBlocker } from "../../../shared/boards/dependencies"
import { onRejected } from "../../../shared/errors"
import type { JsonValue } from "../../../shared/json"
import type { ClientCommand } from "../../../shared/protocol"


export interface CardDrawerSocket {
  command<TResult = JsonValue>(command: ClientCommand): Promise<TResult>
}

export interface CardDrawerProps {
  cardId: string
  socket: CardDrawerSocket
  chatFacts?: Readonly<Record<string, BoardChatFacts>>
  cardFields?: readonly FieldDef[]
  boardCards?: readonly BlockerCandidate[]
  onClose: () => void
  onChanged?: () => void
}

const NO_CANDIDATES: readonly BlockerCandidate[] = []

function openChatTab(chatId: string) {
  usePaneLayoutStore.getState().openTab({ kind: "chat", chatId })
}

const NO_LINKS: readonly CardLink[] = []
const NO_FIELDS: readonly FieldDef[] = []
const NO_CONTENT: CardContent = {}
const NO_BLOCKERS: readonly CardBlocker[] = []

const GITHUB_SYNCED_FIELDS = new Set(["labels", "assignee"])

function chatLinksOf(links: readonly CardLink[]): CardLink[] {
  return links.filter((entry) => entry.kind === "chat").sort((a, b) => b.createdAt - a.createdAt)
}

function IssueIdentityRow({ externalRef, content }: { externalRef: string; content: CardContent }) {
  const urlEntry = content.externalUrl
  const url = urlEntry?.kind === "url" ? urlEntry.value : null
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="font-mono text-xs tabular-nums text-muted-foreground">#{externalRef}</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open on GitHub"
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink aria-hidden className="size-3" />
        </a>
      ) : null}
    </div>
  )
}

export function CardDrawer({
  cardId,
  socket,
  chatFacts,
  cardFields,
  boardCards,
  onClose,
  onChanged,
}: CardDrawerProps) {
  const detail = useCardDrawerStore((state) => state.detail)
  const error = useCardDrawerStore((state) => state.error)
  const draft = useCardDrawerStore((state) => state.draft)
  const { setDetail, setError, setDraft, reset } = useCardDrawerStore.getState()

  const load = useCallback(() => {
    void socket
      .command<CardDetailView | null>({ type: "board.card.detail", cardId })
      .then(setDetail)
      .catch(onRejected((error) => {
        setError(error.message)
      }))
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
      .catch(onRejected((error) => {
        setError(error.message)
      }))
  }, [cardId, load, onChanged, setDraft, setError, socket])

  const handleDependencyChanged = useCallback(() => {
    load()
    onChanged?.()
  }, [load, onChanged])

  const handleArchive = useCallback(() => {
    void socket
      .command({ type: "board.card.archive", cardId })
      .then(() => {
        onChanged?.()
        onClose()
      })
      .catch(onRejected((error) => {
        setError(error.message)
      }))
  }, [cardId, onChanged, onClose, setError, socket])

  const handleStartWork = useCallback(() => {
    useCardDrawerStore.getState().beginStartWork()
    void socket
      .command<StartWorkResult>({ type: "board.card.startWork", cardId })
      .then((result) => {
        openChatTab(result.chatId)
        useCardDrawerStore.getState().endStartWork(describeStartWork(result))
        load()
        onChanged?.()
      })
      .catch(onRejected((error) => {
        useCardDrawerStore.getState().endStartWork(null)
        setError(error.message)
      }))
  }, [cardId, load, onChanged, setError, socket])

  const handleCleanup = useCallback(
    (decision: CleanupDecision) => {
      useCardDrawerStore.getState().beginCleanup()
      void socket
        .command({ type: "board.card.resolveWorktree", cardId, decision })
        .then(() => {
          useCardDrawerStore.getState().endCleanup()
          load()
          onChanged?.()
        })
        .catch(onRejected((error) => {
          useCardDrawerStore.getState().endCleanup()
          setError(error.message)
        }))
    },
    [cardId, load, onChanged, setError, socket],
  )

  const handleMerge = useCallback(() => {
    handleCleanup("merge")
  }, [handleCleanup])
  const handleDiscard = useCallback(() => {
    handleCleanup("discard")
  }, [handleCleanup])
  const handleLeave = useCallback(() => {
    handleCleanup("leave")
  }, [handleCleanup])

  const handleDraft = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(event.currentTarget.value)
    },
    [setDraft],
  )

  const handleFieldCommit = useCallback(
    (fieldId: string, value: FieldValue | null) => {
      const content = useCardDrawerStore.getState().detail?.card.content
      if (!content) return
      void socket
        .command({ type: "board.card.update", cardId, content: nextCardContent(content, fieldId, value) })
        .then(() => {
          load()
          onChanged?.()
        })
        .catch(onRejected((error) => {
          setError(error.message)
        }))
    },
    [cardId, load, onChanged, setError, socket],
  )

  const startingWork = useCardDrawerStore((state) => state.startingWork)
  const startWorkNote = useCardDrawerStore((state) => state.startWorkNote)
  const resolvingCleanup = useCardDrawerStore((state) => state.resolvingCleanup)

  const card = detail?.card ?? null
  const startWork = detail?.startWork ?? null
  const cleanup = detail?.cleanup ?? null
  const discardBlocked = cleanup ? discardBlockedReason(cleanup) : null
  const mergeBlocked = cleanup ? mergeBlockedReason(cleanup) : null
  const content = card?.content ?? NO_CONTENT
  const fields = cardFields ?? NO_FIELDS
  const chatLinks = chatLinksOf(detail?.links ?? NO_LINKS)
  const facts = chatFacts ?? NO_BOARD_CHAT_FACTS
  const githubCard =
    detail?.externalRef != null &&
    fields.length > 0 &&
    fields.every((f) => GITHUB_SYNCED_FIELDS.has(f.id))

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background",
        "sm:w-[400px]",
      )}
      aria-label="Card detail"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-15 font-semibold leading-snug text-foreground [text-wrap:pretty]">
            {card?.title ?? "Loading…"}
          </h2>
          {detail?.externalRef ? (
            <IssueIdentityRow externalRef={detail.externalRef} content={content} />
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-4" />
        </button>
      </header>

      {error ? <p className="px-4 py-2 text-13 text-destructive-text">{error}</p> : null}

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
              <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                {startWork.branch}
              </span>
            </div>
            {startWork.blockedReason ? (
              <p className="text-13 text-muted-foreground">{startWork.blockedReason}</p>
            ) : null}
            {startWorkNote ? <p className="text-13 text-muted-foreground">{startWorkNote}</p> : null}
          </section>
        ) : null}

        {card ? (
          <CardDependencies
            cardId={card.id}
            blockers={detail?.blockers ?? NO_BLOCKERS}
            candidates={boardCards ?? NO_CANDIDATES}
            socket={socket}
            onChanged={handleDependencyChanged}
            onError={setError}
          />
        ) : null}

        {cleanup ? (
          <section className="space-y-2 border border-border p-3">
            <p className="text-13 text-foreground [text-wrap:pretty]">
              This card is done. What should happen to <span className="font-mono">{cleanup.branch}</span>?
            </p>
            <p className="text-13 tabular-nums text-muted-foreground">
              {describeWorktreeContents(cleanup)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleMerge} disabled={resolvingCleanup || mergeBlocked !== null}>
                Merge
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDiscard}
                disabled={resolvingCleanup || discardBlocked !== null}
              >
                Discard worktree
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLeave} disabled={resolvingCleanup}>
                Leave it
              </Button>
            </div>
            {discardBlocked ? <p className="text-13 text-muted-foreground">{discardBlocked}</p> : null}
            {mergeBlocked ? <p className="text-13 text-muted-foreground">{mergeBlocked}</p> : null}
          </section>
        ) : null}

        {chatLinks.length > 0 ? (
          <section>
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">Linked chat</h3>
            <ul className="space-y-0.5">
              {chatLinks.map((chatLink) => (
                <LinkedChat
                  key={chatLink.targetId}
                  chatId={chatLink.targetId}
                  chat={facts[chatLink.targetId]}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {fields.length > 0 ? (
          <dl className="space-y-3 text-13">
            {fields.map((field) => (
              <CardFieldRow
                key={field.id}
                field={field}
                value={content[field.id]}
                onCommit={handleFieldCommit}
                readOnly={githubCard}
              />
            ))}
          </dl>
        ) : null}

        <section>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Comments</h3>
          {detail && detail.comments.length === 0 ? (
            <p className="text-13 text-muted-foreground">Nothing recorded yet.</p>
          ) : null}
          <ul className="space-y-3">
            {(detail?.comments ?? []).map((comment) => (
              <li key={comment.id} className="border-b border-border pb-3 last:border-b-0">
                <p className="text-xs text-muted-foreground">{authorLabel(comment.author.kind)}</p>
                <p className="whitespace-pre-wrap text-13 text-foreground">{comment.body}</p>
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



interface CardFieldProps {
  field: FieldDef
  value: FieldValue | undefined
  onCommit: (fieldId: string, value: FieldValue | null) => void
  readOnly?: boolean
}

function CardFieldRow({ field, value, onCommit, readOnly }: CardFieldProps) {
  const stacked = field.kind === "longtext"
  return (
    <div className={stacked ? "space-y-1" : "flex gap-3"}>
      <dt
        className={cn(
          "shrink-0 text-muted-foreground",
          stacked ? "text-xs font-medium" : "w-20 pt-0.5",
        )}
      >
        {field.label}
      </dt>
      <dd className="min-w-0 flex-1">
        <CardFieldControl field={field} value={value} onCommit={onCommit} readOnly={readOnly} />
      </dd>
    </div>
  )
}

function ReadOnlyFieldValue({ field, value }: Pick<CardFieldProps, "field" | "value">) {
  const display = fieldDisplayText(field, value)
  return (
    <span
      className={cn(
        "px-1.5 py-0.5 text-13",
        display === "" ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {display === "" ? emptyHint(field) : display}
    </span>
  )
}

function CardFieldControl({ readOnly, ...props }: CardFieldProps) {
  if (readOnly) return <ReadOnlyFieldValue field={props.field} value={props.value} />
  switch (props.field.kind) {
    case "select":
      return <SelectFieldValue {...props} />
    case "multiselect":
      return <MultiSelectFieldValue {...props} />
    default:
      return <InlineFieldValue {...props} />
  }
}

function emptyHint(field: FieldDef): string {
  return field.required ? "Required" : "Empty"
}

function OptionDot({ token }: { token: ColumnColorToken | null }) {
  if (!token) return null
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", COLUMN_DOT_CLASS[token])} />
}

const TEXT_INPUT_TYPE: Readonly<Record<string, string>> = { url: "url", number: "number", date: "date" }

function InlineFieldValue({ field, value, onCommit }: CardFieldProps) {
  const editing = useCardDrawerStore((state) => state.editingFieldId === field.id)
  const draft = useCardDrawerStore((state) => state.fieldDraft)

  const handleBegin = useCallback(() => {
    useCardDrawerStore.getState().beginFieldEdit(field.id, fieldDraftText(field, value))
  }, [field, value])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      useCardDrawerStore.getState().setFieldDraft(event.currentTarget.value)
    },
    [],
  )

  const handleCommit = useCallback(() => {
    const taken = useCardDrawerStore.getState().takeFieldDraft(field.id)
    if (taken === null) return
    onCommit(field.id, parseFieldDraft(field, taken))
  }, [field, onCommit])

  const handleKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Escape") useCardDrawerStore.getState().cancelFieldEdit()
      else if (event.key === "Enter" && field.kind !== "longtext") handleCommit()
    },
    [field.kind, handleCommit],
  )

  const focusControl = useCallback((element: HTMLInputElement | HTMLTextAreaElement | null) => {
    element?.focus()
  }, [])

  const numeric = field.kind === "number" || field.kind === "date"
  const display = fieldDisplayText(field, value)

  if (editing) {
    return field.kind === "longtext" ? (
      <Textarea
        ref={focusControl}
        value={draft}
        aria-label={field.label}
        rows={Math.min(20, Math.max(3, draft.split("\n").length + 1))}
        onChange={handleChange}
        onBlur={handleCommit}
        onKeyDown={handleKey}
      />
    ) : (
      <input
        ref={focusControl}
        type={TEXT_INPUT_TYPE[field.kind] ?? "text"}
        value={draft}
        aria-label={field.label}
        aria-required={field.required || undefined}
        onChange={handleChange}
        onBlur={handleCommit}
        onKeyDown={handleKey}
        className={cn(
          "w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-13 text-foreground",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          numeric && "tabular-nums",
        )}
      />
    )
  }

  const editButton = (
    <button
      type="button"
      aria-label={`Edit ${field.label}`}
      onClick={handleBegin}
      className={cn(
        "rounded-md px-1.5 py-0.5 text-left hover:bg-secondary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        display === "" ? "text-muted-foreground" : "text-foreground",
        numeric && "tabular-nums",
        field.kind === "longtext" && "block w-full whitespace-pre-wrap text-sm leading-relaxed [text-wrap:pretty]",
      )}
    >
      {display === "" ? emptyHint(field) : display}
    </button>
  )

  if (field.kind === "url" && display !== "") {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <a
          href={display}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-w-0 items-center gap-1 truncate text-info-text hover:underline"
        >
          <span className="truncate">{display.replace(/^https:\/\//, "")}</span>
          <ExternalLink aria-hidden className="size-3 shrink-0" />
        </a>
        <button
          type="button"
          aria-label={`Edit ${field.label}`}
          onClick={handleBegin}
          className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Pencil aria-hidden className="size-3" />
        </button>
      </span>
    )
  }

  return editButton
}

const CLEAR_SELECTION = "c"

function optionValue(optionId: string): string {
  return `o:${optionId}`
}

function SelectFieldValue({ field, value, onCommit }: CardFieldProps) {
  const optionId = selectedOptionId(value)

  const handleChange = useCallback(
    (chosen: string) => {
      onCommit(field.id, chosen === CLEAR_SELECTION ? null : parseFieldDraft(field, chosen.slice(2)))
    },
    [field, onCommit],
  )

  return (
    <Select value={optionId === null ? CLEAR_SELECTION : optionValue(optionId)} onValueChange={handleChange}>
      <SelectTrigger
        aria-label={field.label}
        className="h-8 px-2 text-13 [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-2"
      >
        <SelectValue placeholder={emptyHint(field)} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={CLEAR_SELECTION}>{emptyHint(field)}</SelectItem>
        {optionsOf(field).map((option) => (
          <SelectItem key={option.id} value={optionValue(option.id)}>
            <span className="flex items-center gap-2">
              <OptionDot token={option.colorToken} />
              {option.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function MultiSelectFieldValue({ field, value, onCommit }: CardFieldProps) {
  const held = selectedOptionIds(value)

  const handleToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const optionIds = toggledOptionIds(value, event.currentTarget.value)
      onCommit(field.id, optionIds.length === 0 ? null : { kind: "multiselect", optionIds })
    },
    [field.id, onCommit, value],
  )

  const options = optionsOf(field)
  if (options.length === 0) {
    return <span className="px-1.5 text-muted-foreground">{emptyHint(field)}</span>
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {options.map((option) => {
        const pressed = held.includes(option.id)
        return (
          <button
            key={option.id}
            type="button"
            value={option.id}
            aria-label={option.label}
            aria-pressed={pressed}
            onClick={handleToggle}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-1.5 py-0.5",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              pressed
                ? "border-border font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-secondary",
            )}
          >
            <OptionDot token={option.colorToken} />
            {option.label}
          </button>
        )
      })}
    </span>
  )
}

function LinkedChat({ chatId, chat }: { chatId: string; chat: BoardChatFacts | undefined }) {
  const handleOpen = useCallback(() => {
    openChatTab(chatId)
  }, [chatId])

  if (!chat) {
    return <li className="px-1.5 py-1 text-13 text-muted-foreground">This chat no longer exists.</li>
  }

  const indicator = chatStatusIndicator(chat)
  const detailRows = workDetailRows(chat.activity)

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden className="flex h-3 w-1.5 shrink-0 items-center">
          {indicator ? (
            <span className={cn("size-1.5 rounded-full", chatDotBgClass(indicator.tone))} />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-13 text-foreground">{chat.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {indicator?.label ?? statusLabel(chat.status)}
        </span>
      </button>
      {detailRows.map((row) => (
        <p key={row} data-work-row className="px-3.5 py-0.5 text-xs text-muted-foreground">
          {row}
        </p>
      ))}
    </li>
  )
}
