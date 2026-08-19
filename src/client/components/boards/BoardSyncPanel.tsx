import { useCallback, useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { SegmentedControl, type SegmentedOption } from "../ui/segmented-control"
import { bindingSlug, useBoardSyncPanelStore } from "./BoardSyncPanel.store"
import { parseRepoSlug } from "../../../shared/boards/repo-slug"
import type { BoardSyncStatus, SyncColumnRouting } from "../../../shared/boards/sync-types"
import type { SyncConflict, SyncDirection } from "../../../shared/boards/types"
import { errorMessage, type AnyValue } from "../../../shared/errors"

/**
 * Where a board's cards come from.
 *
 * A panel inside the board pane, like the card drawer, because binding a board
 * is reasoning ABOUT the board — the columns it will route into need to stay in
 * view while the choice is made.
 *
 * It shows the routing rather than offering it. Open/closed is the one state
 * every tracker has, and it meets a board's user-named columns through column
 * semantics alone; a second way to say where a card goes would be a second way
 * for this screen and the sync engine to disagree.
 */

export interface BoardSyncPanelSocket {
  command<TResult = AnyValue>(command: AnyValue): Promise<TResult>
}

export interface BoardSyncPanelProps {
  boardId: string
  socket: BoardSyncPanelSocket
  onClose: () => void
}

const DIRECTIONS: SegmentedOption<SyncDirection>[] = [
  { value: "pull", label: "Pull" },
  { value: "push", label: "Push" },
  { value: "both", label: "Both" },
]

/**
 * The button always ADDS a repo — a board holds N bindings, and an existing
 * one is changed by disconnecting it and connecting it again, not by editing
 * "the" binding through a field that cannot say which one it means.
 */
const SAVE_LABEL = "Connect"

/** What a conflict was about, in the reader's terms rather than the store's. */
function conflictLine(conflict: SyncConflict): string {
  const kept = conflict.resolvedAs === "local" ? "kept yours" : "took theirs"
  return `${conflict.field} changed in both places · ${kept}`
}

/**
 * One row's disconnect button. A component rather than an inline arrow in the
 * map so the handler is bound once per row instead of re-created every render.
 */
function BindingDisconnect({
  bindingId,
  onDisconnect,
}: {
  bindingId: string
  onDisconnect: (bindingId: string) => void
}) {
  const handleClick = useCallback(() => {
    onDisconnect(bindingId)
  }, [bindingId, onDisconnect])

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Disconnect ${bindingId}`}
      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-destructive-text"
    >
      <X className="size-3.5" />
    </button>
  )
}

function RoutingRow({ label, column, absent }: { label: string; column: { title: string } | null; absent: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={column ? "text-foreground" : "text-muted-foreground"}>{column?.title ?? absent}</dd>
    </div>
  )
}

/** Unmapped columns warn; they never block. A one-way pull does not need them. */
function routingWarning(routing: SyncColumnRouting, direction: SyncDirection): string | null {
  if (!routing.open && !routing.closed) {
    return "This board marks no column as start or done, so pulled issues land in the first column and closing one moves nothing."
  }
  if (!routing.open) return "No column is marked start, so pulled issues land in the first column."
  if (!routing.closed && direction !== "pull") {
    return "No column is marked done, so nothing on this board can close an issue."
  }
  return null
}

export function BoardSyncPanel({ boardId, socket, onClose }: BoardSyncPanelProps) {
  const status = useBoardSyncPanelStore((state) => state.status)
  const error = useBoardSyncPanelStore((state) => state.error)
  const saving = useBoardSyncPanelStore((state) => state.saving)
  const repoDraft = useBoardSyncPanelStore((state) => state.repoDraft)
  const direction = useBoardSyncPanelStore((state) => state.direction)
  const allowAgentPush = useBoardSyncPanelStore((state) => state.allowAgentPush)
  const { setStatus, setError, setRepoDraft, setDirection, setAllowAgentPush, reset } =
    useBoardSyncPanelStore.getState()

  const load = useCallback(() => {
    void socket
      .command<BoardSyncStatus>({ type: "board.sync.status", boardId })
      .then(setStatus)
      .catch((cause: AnyValue) => {
        setError(errorMessage(cause))
      })
  }, [boardId, setError, setStatus, socket])

  useEffect(() => {
    reset()
    load()
  }, [load, reset])

  const handleRepo = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRepoDraft(event.currentTarget.value)
    },
    [setRepoDraft],
  )

  const handleAgentPush = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setAllowAgentPush(event.currentTarget.checked)
    },
    [setAllowAgentPush],
  )

  const handleSave = useCallback(() => {
    const state = useBoardSyncPanelStore.getState()
    const slug = parseRepoSlug(state.repoDraft)
    if (!slug) {
      setError("That is not a repository. Use owner/repo, or paste its GitHub URL.")
      return
    }
    state.beginSave()
    void socket
      .command({
        type: "board.sync.bind",
        boardId,
        owner: slug.owner,
        repo: slug.repo,
        direction: state.direction,
        allowAgentPush: state.allowAgentPush,
      })
      .then(() => {
        useBoardSyncPanelStore.getState().endSave()
        load()
      })
      .catch((cause: AnyValue) => {
        useBoardSyncPanelStore.getState().endSave()
        setError(errorMessage(cause))
      })
  }, [boardId, load, setError, socket])

  const handleDisconnect = useCallback(
    (bindingId: string) => {
      // Disconnecting a repo leaves its cards alone — only the link is cut —
      // so this needs no confirm step the way archiving a board does.
      void socket
        .command({ type: "board.sync.unbind", boardId, bindingId })
        .then(load)
        .catch((cause: AnyValue) => {
          setError(errorMessage(cause))
        })
    },
    [boardId, load, setError, socket],
  )

  const warning = status ? routingWarning(status.routing, direction) : null

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background sm:w-[400px]"
      aria-label="Sync settings"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground">Sync</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sync settings"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-4" />
        </button>
      </header>

      {error ? <p className="px-4 py-2 text-[13px] text-destructive-text">{error}</p> : null}

      {status ? (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="board-sync-repo">
              GitHub repository
            </label>
            <Input
              id="board-sync-repo"
              value={repoDraft}
              onChange={handleRepo}
              placeholder="owner/repo"
              spellCheck={false}
              className="font-mono text-[13px]"
            />
            {repoDraft.length > 0 ? (
              <p className="text-[13px] text-muted-foreground">Read from this project&rsquo;s origin remote.</p>
            ) : null}
          </section>

          {status.bindings.length > 0 ? (
            <section className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Connected repositories</p>
              <ul className="space-y-1">
                {status.bindings.map((binding) => (
                  <li
                    key={binding.id}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
                      {bindingSlug(binding) ?? binding.providerId}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{binding.direction}</span>
                    <BindingDisconnect bindingId={binding.id} onDisconnect={handleDisconnect} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Direction</p>
            <SegmentedControl value={direction} onValueChange={setDirection} options={DIRECTIONS} size="sm" />
          </section>

          <section className="space-y-2">
            <label className="flex items-start gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={allowAgentPush}
                onChange={handleAgentPush}
                className="mt-0.5 accent-primary"
              />
              <span>
                Let agent changes reach GitHub
                {/* Off by default: an agent dragging a card to done must not
                    silently close a real issue. */}
                <span className="block text-muted-foreground">
                  Off by default. An agent moving a card to done would otherwise close the issue.
                </span>
              </span>
            </label>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Where issues land</p>
            <dl className="space-y-2 text-[13px]">
              <RoutingRow label="Open issues" column={status.routing.open} absent="First column" />
              <RoutingRow label="Closed issues" column={status.routing.closed} absent="Nowhere" />
            </dl>
            {warning ? <p className="text-[13px] text-muted-foreground [text-wrap:pretty]">{warning}</p> : null}
          </section>

          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Conflicts</p>
            {status.conflicts.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Nothing has changed in both places.</p>
            ) : (
              <ul className="space-y-2">
                {status.conflicts.map((conflict) => (
                  <li key={conflict.id} className="border-b border-border pb-2 text-[13px] last:border-b-0">
                    <p className="text-foreground">{conflictLine(conflict)}</p>
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">{conflict.cardId}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-sm text-muted-foreground">Loading sync settings…</p>
        </div>
      )}

      <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Button size="sm" onClick={handleSave} disabled={saving || !status}>
          {saving ? "Saving…" : SAVE_LABEL}
        </Button>
      </footer>
    </aside>
  )
}
