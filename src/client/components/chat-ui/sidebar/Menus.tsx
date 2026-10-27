import { type ReactNode } from "react"
import { Archive, Code, Copy, EyeOff, FolderOpen, Pencil, Pin, PinOff, ScrollText, ShieldAlert, Split, SquareKanban, Star, StarOff, Trash2 } from "lucide-react"
import { ContextMenu, ContextMenuTrigger } from "../../ui/context-menu"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"
import { InputPopoverStore } from "../InputPopover.store"
import {
  ContextMenuActions,
  PopoverMenuActions,
  stackActions,
  type MenuAction,
  type StackActionHandlers,
} from "./menuActions"

function ActionContextMenu({ actions, children }: { actions: MenuAction[]; children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuActions actions={actions} />
    </ContextMenu>
  )
}

export function ProjectSectionMenu({
  editorLabel,
  onOpenBoards,
  starred,
  onCopyPath,
  onShowArchived,
  onOpenInFinder,
  onOpenInEditor,
  onToggleStar,
  onEditInstructions,
  onHide,
  onDelete,
  children,
}: {
  editorLabel: string
  starred: boolean
  onOpenBoards?: () => void
  onCopyPath: () => void
  onShowArchived: () => void
  onOpenInFinder: () => void
  onOpenInEditor: () => void
  onToggleStar: () => void
  onEditInstructions?: () => void
  onHide: () => void
  onDelete?: () => void
  children: ReactNode
}) {
  const actions: MenuAction[] = [
    ...(onOpenBoards
      ? [{ id: "boards", label: "Boards", icon: SquareKanban, run: onOpenBoards, separatorAfter: true }]
      : []),
    {
      id: "star",
      label: starred ? "Unstar project" : "Star project",
      icon: starred ? StarOff : Star,
      run: onToggleStar,
    },
    ...(onEditInstructions
      ? [{ id: "instructions", label: "Edit instructions", icon: ScrollText, run: onEditInstructions }]
      : []),
    { id: "copy-path", label: "Copy Path", icon: Copy, run: onCopyPath },
    { id: "show-archived", label: "Show Archived", icon: Archive, run: onShowArchived },
    { id: "open-finder", label: "Show in Finder", icon: FolderOpen, run: onOpenInFinder },
    { id: "open-editor", label: `Open in ${editorLabel}`, icon: Code, run: onOpenInEditor },
    { id: "hide", label: "Hide", icon: EyeOff, run: onHide, destructive: true },
    ...(onDelete
      ? [{ id: "delete", label: "Delete project", icon: Trash2, run: onDelete, destructive: true }]
      : []),
  ]
  return <ActionContextMenu actions={actions}>{children}</ActionContextMenu>
}

export function ChatRowMenu({
  canFork,
  onRename,
  onOpenInFinder,
  onFork,
  onArchive,
  pinned,
  onTogglePin,
  onDelete,
  onEditPermissions,
  children,
}: {
  canFork?: boolean
  onRename: () => void
  onOpenInFinder: () => void
  onFork: () => void
  onArchive: () => void
  pinned: boolean
  onTogglePin: () => void
  onDelete: () => void
  onEditPermissions?: () => void
  children: ReactNode
}) {
  const actions: MenuAction[] = [
    {
      id: "pin",
      label: pinned ? "Unpin" : "Pin to top",
      icon: pinned ? PinOff : Pin,
      run: onTogglePin,
      keepsMenuOpen: true,
    },
    { id: "rename", label: "Rename", icon: Pencil, run: onRename, keepsMenuOpen: true },
    { id: "open-finder", label: "Open in Finder", icon: FolderOpen, run: onOpenInFinder, keepsMenuOpen: true },
    { id: "fork", label: "Fork", icon: Split, run: onFork, disabled: !canFork, keepsMenuOpen: true },
    ...(onEditPermissions
      ? [{ id: "permissions", label: "Permissions…", icon: ShieldAlert, run: onEditPermissions, keepsMenuOpen: true }]
      : []),
    { id: "archive", label: "Archive", icon: Archive, run: onArchive, keepsMenuOpen: true },
    { id: "delete", label: "Delete", icon: Trash2, run: onDelete, destructive: true, keepsMenuOpen: true },
  ]
  return <ActionContextMenu actions={actions}>{children}</ActionContextMenu>
}

type StackMenuProps = StackActionHandlers & {
  stackTitle: string
  children: ReactNode
}

function StackActionsPopoverInner({ stackTitle, children, ...handlers }: StackMenuProps) {
  const open = InputPopoverStore.useScopedStore((s) => s.open)
  const setOpen = InputPopoverStore.useScopedStore((s) => s.setOpen)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-44 p-1"
        role="menu"
        aria-label={`Actions for ${stackTitle}`}
      >
        <PopoverMenuActions
          actions={stackActions(stackTitle, handlers, { keepsMenuOpen: false })}
          onSelected={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

export function StackActionsPopover(props: StackMenuProps) {
  return (
    <InputPopoverStore.Provider init={undefined}>
      <StackActionsPopoverInner {...props} />
    </InputPopoverStore.Provider>
  )
}

export function StackSectionMenu({ stackTitle, children, ...handlers }: StackMenuProps) {
  return (
    <ActionContextMenu actions={stackActions(stackTitle, handlers, { keepsMenuOpen: true })}>
      {children}
    </ActionContextMenu>
  )
}
