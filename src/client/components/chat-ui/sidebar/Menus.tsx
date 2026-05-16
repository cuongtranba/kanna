import { useState, type ReactNode } from "react"
import { Archive, Code, Copy, EyeOff, FolderOpen, Pencil, ShieldAlert, Split, Star, StarOff, Trash2, UserRoundPlus, Users } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"

export function ProjectSectionMenu({
  editorLabel,
  starred,
  onCopyPath,
  onShowArchived,
  onOpenInFinder,
  onOpenInEditor,
  onToggleStar,
  onHide,
  children,
}: {
  editorLabel: string
  starred: boolean
  onCopyPath: () => void
  onShowArchived: () => void
  onOpenInFinder: () => void
  onOpenInEditor: () => void
  onToggleStar: () => void
  onHide: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onToggleStar()
          }}
        >
          {starred ? <StarOff className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
          <span className="text-xs font-medium">{starred ? "Unstar project" : "Star project"}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onCopyPath()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Copy Path</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onShowArchived()
          }}
        >
          <Archive className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Show Archived</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onOpenInFinder()
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Show in Finder</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onOpenInEditor()
          }}
        >
          <Code className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Open in {editorLabel}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onHide()
          }}
          className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
        >
          <EyeOff className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Hide</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ChatRowMenu({
  canFork,
  onRename,
  onShare,
  onOpenInFinder,
  onFork,
  onArchive,
  onDelete,
  onEditPermissions,
  children,
}: {
  canFork?: boolean
  onRename: () => void
  onShare: () => void
  onOpenInFinder: () => void
  onFork: () => void
  onArchive: () => void
  onDelete: () => void
  onEditPermissions?: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onRename()
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Rename</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onShare()
          }}
        >
          <UserRoundPlus className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Share</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onOpenInFinder()
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Open in Finder</span>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canFork}
          onSelect={(event) => {
            event.preventDefault()
            if (!canFork) return
            onFork()
          }}
        >
          <Split className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Fork</span>
        </ContextMenuItem>
        {onEditPermissions ? (
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault()
              onEditPermissions()
            }}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Permissions…</span>
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onArchive()
          }}
        >
          <Archive className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Archive</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onDelete()
          }}
          className="text-destructive dark:text-red-400 hover:bg-destructive/10 focus:bg-destructive/10 dark:hover:bg-red-500/20 dark:focus:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Delete</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function StackActionsPopover({
  stackTitle,
  onRename,
  onEditMembers,
  onDelete,
  children,
}: {
  stackTitle: string
  onRename: () => void
  onEditMembers: () => void
  onDelete: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  function handle(action: () => void) {
    return () => {
      setOpen(false)
      action()
    }
  }

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
        <button
          type="button"
          role="menuitem"
          onClick={handle(onRename)}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium hover:bg-muted focus-visible:bg-muted outline-hidden"
        >
          <Pencil className="h-3.5 w-3.5" />
          <span>Rename</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={handle(onEditMembers)}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium hover:bg-muted focus-visible:bg-muted outline-hidden"
        >
          <Users className="h-3.5 w-3.5" />
          <span>Edit members</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={handle(onDelete)}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs font-medium text-destructive dark:text-red-400 hover:bg-destructive/10 focus-visible:bg-destructive/10 dark:hover:bg-red-500/20 dark:focus-visible:bg-red-500/20 outline-hidden"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete {stackTitle}</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}

export function StackSectionMenu({
  stackTitle,
  onRename,
  onEditMembers,
  onDelete,
  children,
}: {
  stackTitle: string
  onRename: () => void
  onEditMembers: () => void
  onDelete: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onRename()
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Rename</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onEditMembers()
          }}
        >
          <Users className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Edit members</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.preventDefault()
            onDelete()
          }}
          className="text-destructive dark:text-red-400 hover:bg-destructive/10 focus:bg-destructive/10 dark:hover:bg-red-500/20 dark:focus:bg-red-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Delete {stackTitle}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
