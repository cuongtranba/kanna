import type { ReactNode } from "react"
import { Code, Copy, FolderOpen, Trash2 } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu"

export function ProjectSectionMenu({
  editorLabel,
  onCopyPath,
  onOpenInFinder,
  onOpenInEditor,
  onRemove,
  children,
}: {
  editorLabel: string
  onCopyPath: () => void
  onOpenInFinder: () => void
  onOpenInEditor: () => void
  onRemove: () => void
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
            onCopyPath()
          }}
        >
          <Copy className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Copy Path</span>
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
            onRemove()
          }}
          className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Remove</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
