import { useCallback, useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { SegmentedControl, type SegmentedOption } from "../ui/segmented-control"
import { BoardSyncPanelStore } from "./BoardSyncPanel.store"
import {
  formatRepoSlug,
  parseRepoSlug,
  sameRepoSlug,
  sourceRefRepoSlug,
  type RepoSlug,
} from "../../../shared/boards/repo-slug"
import type { RepoSuggestion, SyncColumnRouting } from "../../../shared/boards/sync-types"
import type { SyncBinding, SyncConflict, SyncDirection } from "../../../shared/boards/types"
import { onRejected } from "../../../shared/errors"
import type { CommandPort } from "../../ports/commandPort"


export type BoardSyncPanelSocket = CommandPort

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

function conflictLine(conflict: SyncConflict): string {
  const kept = conflict.resolvedAs === "local" ? "kept yours" : "took theirs"
  return `${conflict.field} changed in both places · ${kept}`
}

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

function isAlreadyConnected(suggestion: RepoSuggestion, bindings: readonly SyncBinding[]): boolean {
  if (!suggestion.repo) return false
  const slug = suggestion.repo
  return bindings.some((b) => b.sourceRef.provider === "github-issues" && sameRepoSlug(b.sourceRef, slug))
}

function offerLabel(isBoundElsewhere: boolean, isSaving: boolean): string {
  if (isSaving) return isBoundElsewhere ? "Moving…" : "Connecting…"
  return isBoundElsewhere ? "Move here" : "Connect"
}

function SuggestionRow({
  suggestion,
  direction,
  isConfirming,
  isSaving,
  onConnect,
  onSetDirection,
  onCancelDetach,
}: {
  suggestion: RepoSuggestion
  direction: SyncDirection
  isConfirming: boolean
  isSaving: boolean
  onConnect: (suggestion: RepoSuggestion) => void
  onSetDirection: (projectId: string, direction: SyncDirection) => void
  onCancelDetach: () => void
}) {
  const handleConnect = useCallback(() => onConnect(suggestion), [onConnect, suggestion])
  const handleDirection = useCallback(
    (dir: SyncDirection) => onSetDirection(suggestion.projectId, dir),
    [onSetDirection, suggestion.projectId],
  )
  const handleCancel = useCallback(() => onCancelDetach(), [onCancelDetach])

  const slug = suggestion.repo ? formatRepoSlug(suggestion.repo) : null

  return (
    <li className="space-y-2 rounded-md border border-border px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-13 font-medium text-foreground">{suggestion.projectName}</p>
          <p className={slug ? "font-mono text-xs text-muted-foreground" : "text-xs italic text-muted-foreground"}>
            {slug ?? "No remote configured"}
          </p>
        </div>
      </div>

      {slug && suggestion.boundTo ? (
        <p className="text-13 text-warning-text [text-wrap:pretty]">
          {isConfirming
            ? `Moving "${slug}" will detach it from "${suggestion.boundTo.boardTitle}". Its ${suggestion.boundTo.cardCount} card${suggestion.boundTo.cardCount === 1 ? "" : "s"} stay on that board.`
            : `Already connected to board "${suggestion.boundTo.boardTitle}" (${suggestion.boundTo.cardCount} card${suggestion.boundTo.cardCount === 1 ? "" : "s"}).`}
        </p>
      ) : null}

      {slug ? (
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={direction}
            onValueChange={handleDirection}
            options={DIRECTIONS}
            size="sm"
          />
          <div className="flex-1" />
          {isConfirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isSaving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleConnect} disabled={isSaving}>
                {isSaving ? offerLabel(true, true) : "Confirm move"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant={suggestion.boundTo ? "ghost" : "default"}
              onClick={handleConnect}
              disabled={isSaving}
            >
              {offerLabel(suggestion.boundTo !== null, isSaving)}
            </Button>
          )}
        </div>
      ) : null}
    </li>
  )
}

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

export function BoardSyncPanel(props: BoardSyncPanelProps) {
  return (
    <BoardSyncPanelStore.Provider init={undefined}>
      <BoardSyncPanelBody {...props} />
    </BoardSyncPanelStore.Provider>
  )
}

function BoardSyncPanelBody({ boardId, socket, onClose }: BoardSyncPanelProps) {
  const panel = BoardSyncPanelStore.useScopedStoreApi()
  const status = BoardSyncPanelStore.useScopedStore((state) => state.status)
  const error = BoardSyncPanelStore.useScopedStore((state) => state.error)
  const saving = BoardSyncPanelStore.useScopedStore((state) => state.saving)
  const repoDraft = BoardSyncPanelStore.useScopedStore((state) => state.repoDraft)
  const direction = BoardSyncPanelStore.useScopedStore((state) => state.direction)
  const allowAgentPush = BoardSyncPanelStore.useScopedStore((state) => state.allowAgentPush)
  const rowDirections = BoardSyncPanelStore.useScopedStore((state) => state.rowDirections)
  const savingRow = BoardSyncPanelStore.useScopedStore((state) => state.savingRow)
  const confirmingDetach = BoardSyncPanelStore.useScopedStore((state) => state.confirmingDetach)
  const { setStatus, setError, setRepoDraft, setDirection, setAllowAgentPush } = panel.getState()

  const load = useCallback(() => {
    void socket
      .command({ type: "board.sync.status", boardId })
      .then(setStatus)
      .catch(onRejected((error) => {
        setError(error.message)
      }))
  }, [boardId, setError, setStatus, socket])

  useEffect(() => {
    load()
  }, [load])

  const bindRepo = useCallback(
    (repo: RepoSlug, projectId: string | null, detachFromBoardId: string | null) => {
      const state = panel.getState()
      const rowDirection = projectId === null ? undefined : state.rowDirections[projectId]
      return socket.command({
        type: "board.sync.bind",
        boardId,
        owner: repo.owner,
        repo: repo.repo,
        direction: rowDirection ?? state.direction,
        allowAgentPush: state.allowAgentPush,
        projectId,
        detachFromBoardId,
      })
    },
    [boardId, socket, panel],
  )

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
    const state = panel.getState()
    const slug = parseRepoSlug(state.repoDraft)
    if (!slug) {
      setError("That is not a repository. Use owner/repo, or paste its GitHub URL.")
      return
    }
    const matchingSuggestion = state.status?.suggestedRepos.find((s) => s.repo && sameRepoSlug(s.repo, slug))
    state.beginSave()
    void bindRepo(slug, matchingSuggestion?.projectId ?? null, null)
      .then(() => {
        panel.getState().endSave()
        load()
      })
      .catch(onRejected((error) => {
        panel.getState().endSave()
        setError(error.message)
      }))
  }, [bindRepo, load, setError, panel])

  const handleDisconnect = useCallback(
    (bindingId: string) => {
      void socket
        .command({ type: "board.sync.unbind", boardId, bindingId })
        .then(load)
        .catch(onRejected((error) => {
          setError(error.message)
        }))
    },
    [boardId, load, setError, socket],
  )

  const handleConnectSuggestion = useCallback(
    (suggestion: RepoSuggestion) => {
      if (!suggestion.repo) return
      const state = panel.getState()
      if (suggestion.boundTo && state.confirmingDetach !== suggestion.projectId) {
        state.setConfirmingDetach(suggestion.projectId)
        return
      }
      state.setSavingRow(suggestion.projectId)
      state.setConfirmingDetach(null)
      void bindRepo(suggestion.repo, suggestion.projectId, suggestion.boundTo?.boardId ?? null)
        .then(() => {
          panel.getState().setSavingRow(null)
          load()
        })
        .catch(onRejected((error) => {
          panel.getState().setSavingRow(null)
          setError(error.message)
        }))
    },
    [bindRepo, load, setError, panel],
  )

  const handleConnectAll = useCallback(() => {
    const state = panel.getState()
    if (!state.status) return
    const bindings = state.status.bindings
    const toConnect = state.status.suggestedRepos.flatMap((s) =>
      s.repo && !s.boundTo && !isAlreadyConnected(s, bindings) ? [{ repo: s.repo, projectId: s.projectId }] : [],
    )
    if (toConnect.length === 0) return
    state.beginSave()
    void Promise.all(toConnect.map((s) => bindRepo(s.repo, s.projectId, null)))
      .then(() => {
        panel.getState().endSave()
        load()
      })
      .catch(onRejected((error) => {
        panel.getState().endSave()
        setError(error.message)
      }))
  }, [bindRepo, load, setError, panel])

  const handleSetRowDirection = useCallback((projectId: string, dir: SyncDirection) => {
    panel.getState().setRowDirection(projectId, dir)
  }, [panel])

  const handleCancelDetach = useCallback(() => {
    panel.getState().setConfirmingDetach(null)
  }, [panel])

  const warning = status ? routingWarning(status.routing, direction) : null

  const visibleSuggestions = status
    ? status.suggestedRepos.filter((s) => !isAlreadyConnected(s, status.bindings))
    : null
  const connectAllCount = visibleSuggestions
    ? visibleSuggestions.filter((s) => s.repo && !s.boundTo).length
    : 0

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background sm:w-[400px]"
      aria-label="Sync settings"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 text-15 font-semibold leading-snug text-foreground">Sync</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sync settings"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-4" />
        </button>
      </header>

      {error ? <p className="px-4 py-2 text-13 text-destructive-text">{error}</p> : null}

      {status ? (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Direction</p>
            <SegmentedControl value={direction} onValueChange={setDirection} options={DIRECTIONS} size="sm" />
          </section>

          <section className="space-y-2">
            <label className="flex items-start gap-2 text-13 text-foreground">
              <input
                type="checkbox"
                checked={allowAgentPush}
                onChange={handleAgentPush}
                className="mt-0.5 accent-primary"
              />
              <span>
                Let agent changes reach GitHub
                <span className="block text-muted-foreground">
                  Off by default. An agent moving a card to done would otherwise close the issue.
                </span>
              </span>
            </label>
          </section>

          {visibleSuggestions && visibleSuggestions.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-xs font-medium text-muted-foreground">
                  {visibleSuggestions.length === 1 ? "Repository" : "Repositories"}
                </p>
                {connectAllCount > 1 ? (
                  <Button size="sm" onClick={handleConnectAll} disabled={saving}>
                    {saving ? "Connecting…" : `Connect all ${connectAllCount}`}
                  </Button>
                ) : null}
              </div>
              <ul className="space-y-2">
                {visibleSuggestions.map((suggestion) => (
                  <SuggestionRow
                    key={suggestion.projectId}
                    suggestion={suggestion}
                    direction={rowDirections[suggestion.projectId] ?? direction}
                    isConfirming={confirmingDetach === suggestion.projectId}
                    isSaving={savingRow === suggestion.projectId}
                    onConnect={handleConnectSuggestion}
                    onSetDirection={handleSetRowDirection}
                    onCancelDetach={handleCancelDetach}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="board-sync-repo">
              {visibleSuggestions && visibleSuggestions.length > 0 ? "Or connect another repository" : "GitHub repository"}
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="board-sync-repo"
                value={repoDraft}
                onChange={handleRepo}
                placeholder="owner/repo"
                spellCheck={false}
                className="flex-1 font-mono text-13"
              />
              <Button size="sm" onClick={handleSave} disabled={saving || repoDraft.trim().length === 0}>
                {saving ? "Saving…" : "Connect"}
              </Button>
            </div>
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
                    <span className="min-w-0 flex-1 truncate font-mono text-13 text-foreground">
                      {sourceRefRepoSlug(binding.sourceRef) ?? binding.providerId}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{binding.direction}</span>
                    <BindingDisconnect bindingId={binding.id} onDisconnect={handleDisconnect} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Where issues land</p>
            <dl className="space-y-2 text-13">
              <RoutingRow label="Open issues" column={status.routing.open} absent="First column" />
              <RoutingRow label="Closed issues" column={status.routing.closed} absent="Nowhere" />
            </dl>
            {warning ? <p className="text-13 text-muted-foreground [text-wrap:pretty]">{warning}</p> : null}
          </section>

          <section className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Conflicts</p>
            {status.conflicts.length === 0 ? (
              <p className="text-13 text-muted-foreground">Nothing has changed in both places.</p>
            ) : (
              <ul className="space-y-2">
                {status.conflicts.map((conflict) => (
                  <li key={conflict.id} className="border-b border-border pb-2 text-13 last:border-b-0">
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
    </aside>
  )
}
