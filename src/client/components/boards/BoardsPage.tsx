import { useCallback, useEffect } from "react"
import { MoreHorizontal, Plus } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { cn } from "../../lib/utils"
import { ownerKey, selectBoards, useBoardsStore } from "../../stores/boardsStore"
import { selectTemplates, useBoardsPageStore } from "./BoardsPage.store"
import { COLUMN_DOT_CLASS } from "../../lib/boards/columnStyle"
import type { BoardsSnapshot } from "../../../shared/protocol"
import type { BoardSummary, BoardTemplate } from "../../../shared/boards/types"
import type { AnyValue } from "../../../shared/errors"

/**
 * The Boards page — `/boards/:projectId`.
 *
 * It answers "what boards does this project have?"; the board PANE answers
 * "where is this card up to?". Opening a row hands the board to a pane tab
 * rather than navigating into it, which is what lets a board sit beside the
 * chat an agent is working in.
 *
 * Rows, not a card grid: the comparison a reader makes runs down one column —
 * which board is busy — and a grid forces reading in two directions to find it.
 */

export interface BoardsPageSocket {
  subscribe<TSnapshot>(topic: AnyValue, onSnapshot: (snapshot: TSnapshot) => void): () => void
  command<TResult = AnyValue>(command: AnyValue): Promise<TResult>
}

export interface BoardsPageProps {
  /**
   * Whether the project already has a chat. A board opens as a pane tab, and
   * the pane workspace only exists on the chat route — so with no chat there is
   * nowhere to put it, and opening one has to start a chat as well. The reader
   * is told that before they click, not after.
   */
  projectId: string
  projectName: string
  hasChat: boolean
  socket: BoardsPageSocket
  /** Hands a board to the pane workspace. */
  onOpenBoard: (boardId: string) => void
}

export function BoardsPage({ projectId, projectName, hasChat, socket, onOpenBoard }: BoardsPageProps) {
  const key = ownerKey("project", projectId)
  const boards = useBoardsStore(selectBoards(key))
  const templates = useBoardsPageStore(selectTemplates)
  const picking = useBoardsPageStore((state) => state.picking)
  const renamingId = useBoardsPageStore((state) => state.renamingId)
  const error = useBoardsPageStore((state) => state.error)
  const { openPicker, closePicker, startRename, stopRename, setError, setTemplates } =
    useBoardsPageStore.getState()

  useEffect(() => {
    return socket.subscribe<BoardsSnapshot>(
      { type: "boards", ownerKind: "project", ownerId: projectId },
      (snapshot) => {
        useBoardsStore.getState().setBoards(ownerKey(snapshot.ownerKind, snapshot.ownerId), snapshot.boards)
      },
    )
  }, [projectId, socket])

  useEffect(() => {
    let cancelled = false
    void socket
      .command<BoardTemplate[]>({ type: "board.templates.list" })
      .then((list) => {
        if (!cancelled) setTemplates(list)
      })
      .catch(() => {
        // A missing template list must not blank the page; the empty board
        // option below still works.
      })
    return () => {
      cancelled = true
    }
  }, [socket, setTemplates])

  const run = useCallback(
    async (command: AnyValue) => {
      try {
        await socket.command(command)
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not work.")
      }
    },
    [socket, setError],
  )

  const handleCreate = useCallback(
    (template: BoardTemplate | null) => {
      closePicker()
      void run({
        type: "board.create",
        ownerKind: "project",
        ownerId: projectId,
        title: template ? template.name : "Untitled board",
        templateId: template?.id ?? null,
      })
    },
    [closePicker, projectId, run],
  )

  const handleRename = useCallback(
    (boardId: string, title: string) => {
      stopRename()
      const trimmed = title.trim()
      if (trimmed === "") return
      void run({ type: "board.update", boardId, title: trimmed })
    },
    [run, stopRename],
  )

  const showPicker = picking || boards.length === 0

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-end justify-between gap-4 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-medium leading-tight tracking-[-0.01em] text-foreground">Boards</h1>
          <p className="truncate text-[13px] text-muted-foreground">
            {projectName}
            {boards.length > 0 ? <span className="tabular-nums"> · {boards.length} boards</span> : null}
          </p>
          {hasChat ? null : (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Opening a board also starts a chat here — a board sits beside one.
            </p>
          )}
        </div>
        {boards.length > 0 ? (
          <Button size="sm" onClick={openPicker}>
            <Plus className="size-3.5" />
            New board
          </Button>
        ) : null}
      </header>

      {error ? (
        <p className="border-b border-border px-6 py-2 text-[13px] text-destructive-text">{error}</p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showPicker ? (
          <TemplatePicker
            templates={templates}
            firstRun={boards.length === 0}
            onPick={handleCreate}
            onCancel={closePicker}
          />
        ) : null}

        {boards.length > 0 ? (
          <ul className="px-4 py-1">
            {boards.map((board) => (
              <BoardRow
                key={board.id}
                board={board}
                renaming={renamingId === board.id}
                onOpen={onOpenBoard}
                onStartRename={startRename}
                onRename={handleRename}
                onCancelRename={stopRename}
                onCommand={run}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

function BoardRow({
  board,
  renaming,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onCommand,
}: {
  board: BoardSummary
  renaming: boolean
  onOpen: (boardId: string) => void
  onStartRename: (boardId: string) => void
  onRename: (boardId: string, title: string) => void
  onCancelRename: () => void
  onCommand: (command: AnyValue) => Promise<void>
}) {
  const handleOpen = useCallback(() => onOpen(board.id), [board.id, onOpen])

  const handleRenameKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") onRename(board.id, event.currentTarget.value)
      if (event.key === "Escape") onCancelRename()
    },
    [board.id, onCancelRename, onRename],
  )

  const handleRenameBlur = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => onRename(board.id, event.currentTarget.value),
    [board.id, onRename],
  )

  return (
    <li className="group grid grid-cols-[1fr_auto_auto] items-center gap-5 border-b border-border px-3 py-3 last:border-b-0 hover:bg-secondary">
      <div className="min-w-0">
        {renaming ? (
          <Input
            autoFocus
            defaultValue={board.title}
            onKeyDown={handleRenameKey}
            onBlur={handleRenameBlur}
            className="h-7 max-w-sm"
            aria-label="Board name"
          />
        ) : (
          <button type="button" onClick={handleOpen} className="block w-full text-left">
            <span className="block truncate text-[15px] font-semibold tracking-[-0.005em] text-foreground">
              {board.title}
            </span>
            {board.description ? (
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{board.description}</span>
            ) : null}
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {/* tabular-nums so a live count cannot reflow the row. */}
        <span>
          <b className="font-medium tabular-nums text-foreground">{board.columnCount}</b> columns
        </span>
        <span>
          <b className="font-medium tabular-nums text-foreground">{board.cardCount}</b> cards
        </span>
      </div>

      <RowMenu board={board} onStartRename={onStartRename} onCommand={onCommand} />
    </li>
  )
}

function RowMenu({
  board,
  onStartRename,
  onCommand,
}: {
  board: BoardSummary
  onStartRename: (boardId: string) => void
  onCommand: (command: AnyValue) => Promise<void>
}) {
  const open = useBoardsPageStore((state) => state.openMenuId === board.id)
  const { openMenu, closeMenu } = useBoardsPageStore.getState()

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) openMenu(board.id)
      else closeMenu()
    },
    [board.id, closeMenu, openMenu],
  )

  const rename = useCallback(() => {
    closeMenu()
    onStartRename(board.id)
  }, [board.id, closeMenu, onStartRename])

  const duplicate = useCallback(() => {
    closeMenu()
    void onCommand({ type: "board.duplicate", boardId: board.id, title: `${board.title} copy` })
  }, [board.id, board.title, closeMenu, onCommand])

  const saveTemplate = useCallback(() => {
    closeMenu()
    void onCommand({ type: "board.saveAsTemplate", boardId: board.id, name: board.title })
  }, [board.id, board.title, closeMenu, onCommand])

  const archive = useCallback(() => {
    closeMenu()
    void onCommand({ type: "board.archive", boardId: board.id })
  }, [board.id, closeMenu, onCommand])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${board.title}`}
          className="rounded-md px-1.5 py-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <MenuButton onClick={rename}>Rename</MenuButton>
        {/* Says "structure" because that is what it copies: a board mirroring a
            300-issue tracker must not silently clone 300 rows. */}
        <MenuButton onClick={duplicate}>Duplicate structure</MenuButton>
        <MenuButton onClick={saveTemplate}>Save as template</MenuButton>
        <div className="my-1 h-px bg-border" />
        <MenuButton onClick={archive} tone="destructive">
          Archive
        </MenuButton>
      </PopoverContent>
    </Popover>
  )
}

function MenuButton({
  onClick,
  children,
  tone,
}: {
  onClick: () => void
  children: React.ReactNode
  tone?: "destructive"
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-xs font-medium hover:bg-secondary",
        tone === "destructive" && "text-destructive-text",
      )}
    >
      {children}
    </button>
  )
}

function TemplatePicker({
  templates,
  firstRun,
  onPick,
  onCancel,
}: {
  templates: BoardTemplate[]
  firstRun: boolean
  onPick: (template: BoardTemplate | null) => void
  onCancel: () => void
}) {
  const handleEmpty = useCallback(() => onPick(null), [onPick])

  return (
    <div className="px-6 py-8">
      {firstRun ? (
        <>
          <h2 className="text-[15px] font-semibold text-foreground">No boards in this project yet.</h2>
          <p className="mt-1 max-w-[58ch] text-sm text-muted-foreground">
            A board turns issues into work your agents can pick up. Start from a shape, or import an existing
            tracker.
          </p>
        </>
      ) : (
        <h2 className="text-[15px] font-semibold text-foreground">Start from a shape</h2>
      )}

      <div className="mt-4 max-w-xl rounded-lg border border-border">
        {templates.map((template) => (
          <TemplateRow key={template.id} template={template} onPick={onPick} />
        ))}
        <button
          type="button"
          onClick={handleEmpty}
          className="flex w-full items-center border-t border-border px-3.5 py-2.5 text-left hover:bg-secondary"
        >
          <span>
            <span className="block text-sm font-medium text-foreground">Empty board</span>
            <span className="block text-xs text-muted-foreground">Name your own columns</span>
          </span>
        </button>
      </div>

      {!firstRun ? (
        <Button variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  )
}

function TemplateRow({
  template,
  onPick,
}: {
  template: BoardTemplate
  onPick: (template: BoardTemplate) => void
}) {
  const handlePick = useCallback(() => onPick(template), [onPick, template])
  const columns = template.definition.columns

  return (
    <button
      type="button"
      onClick={handlePick}
      className="flex w-full items-center gap-3 border-b border-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-secondary"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{template.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {columns.map((column) => column.title).join(" · ")}
        </span>
      </span>
      {/* The shape, previewed: one pip per column in that column's own token. */}
      <span aria-hidden className="ml-auto flex shrink-0 gap-1">
        {columns.map((column, index) => (
          <span
            key={`${template.id}-${String(index)}`}
            className={cn(
              "size-1.5 rounded-full",
              column.colorToken ? COLUMN_DOT_CLASS[column.colorToken] : "bg-muted-icon",
            )}
          />
        ))}
      </span>
    </button>
  )
}
