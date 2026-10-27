import { Fragment, type ReactNode } from "react"
import { Pencil, SquareKanban, Trash2, Users, type LucideIcon } from "lucide-react"
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "../../ui/context-menu"

export interface MenuAction {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  destructive?: boolean
  disabled?: boolean
  keepsMenuOpen?: boolean
  separatorAfter?: boolean
}

interface SelectEvent {
  preventDefault: () => void
  stopPropagation: () => void
}

const DESTRUCTIVE_CONTEXT_CLASS =
  "text-destructive dark:text-red-400 hover:bg-destructive/10 focus:bg-destructive/10 dark:hover:bg-red-500/20 dark:focus:bg-red-500/20"

const POPOVER_ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium hover:bg-muted focus-visible:bg-muted outline-hidden"

const DESTRUCTIVE_POPOVER_CLASS =
  "text-destructive dark:text-red-400 hover:bg-destructive/10 focus-visible:bg-destructive/10 dark:hover:bg-red-500/20 dark:focus-visible:bg-red-500/20"

export function runContextMenuAction(action: MenuAction, event: SelectEvent): void {
  if (action.keepsMenuOpen) event.preventDefault()
  else event.stopPropagation()
  if (action.disabled) return
  action.run()
}

export function ContextMenuActions({ actions }: { actions: MenuAction[] }): ReactNode {
  return (
    <ContextMenuContent>
      {actions.map((action) => (
        <Fragment key={action.id}>
          <ContextMenuItem
            disabled={action.disabled}
            className={action.destructive ? DESTRUCTIVE_CONTEXT_CLASS : undefined}
            onSelect={(event) => runContextMenuAction(action, event)}
          >
            <action.icon className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{action.label}</span>
          </ContextMenuItem>
          {action.separatorAfter ? <ContextMenuSeparator /> : null}
        </Fragment>
      ))}
    </ContextMenuContent>
  )
}

export function PopoverMenuActions({
  actions,
  onSelected,
}: {
  actions: MenuAction[]
  onSelected: () => void
}): ReactNode {
  return (
    <>
      {actions.map((action) => (
        <Fragment key={action.id}>
          <button
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              onSelected()
              action.run()
            }}
            className={action.destructive ? `${POPOVER_ITEM_CLASS} ${DESTRUCTIVE_POPOVER_CLASS}` : POPOVER_ITEM_CLASS}
          >
            <action.icon className="h-3.5 w-3.5" />
            <span>{action.label}</span>
          </button>
          {action.separatorAfter ? <div className="my-1 h-px bg-border" /> : null}
        </Fragment>
      ))}
    </>
  )
}

export interface StackActionHandlers {
  onOpenBoards?: () => void
  onRename: () => void
  onEditMembers: () => void
  onDelete: () => void
}

export function stackActions(
  stackTitle: string,
  handlers: StackActionHandlers,
  options: { keepsMenuOpen: boolean },
): MenuAction[] {
  const { keepsMenuOpen } = options
  return [
    ...(handlers.onOpenBoards
      ? [{ id: "boards", label: "Boards", icon: SquareKanban, run: handlers.onOpenBoards, separatorAfter: true }]
      : []),
    { id: "rename", label: "Rename", icon: Pencil, run: handlers.onRename, keepsMenuOpen },
    { id: "edit-members", label: "Edit members", icon: Users, run: handlers.onEditMembers, keepsMenuOpen },
    {
      id: "delete",
      label: `Delete ${stackTitle}`,
      icon: Trash2,
      run: handlers.onDelete,
      destructive: true,
      keepsMenuOpen,
    },
  ]
}
