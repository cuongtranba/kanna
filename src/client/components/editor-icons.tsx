import { FolderOpen } from "lucide-react"
import type { EditorPreset } from "../../shared/protocol"

export const EDITOR_OPTIONS: Array<{ value: EditorPreset; label: string }> = [
  { value: "cursor", label: "Cursor" },
  { value: "xcode", label: "Xcode" },
  { value: "windsurf", label: "Windsurf" },
  { value: "custom", label: "Custom" },
]

const ICON_SRC: Record<"cursor" | "finder" | "xcode" | "terminal" | "windsurf" | "custom", string> = {
  cursor: "/editor-icons/cursor.png",
  finder: "/editor-icons/finder.png",
  xcode: "/editor-icons/xcode.png",
  terminal: "/editor-icons/terminal.png",
  windsurf: "/editor-icons/windsurf.png",
  custom: "/editor-icons/custom.png",
}

function AppIcon({ src, className }: { src: string; className?: string }) {
  return <img src={src} alt="" aria-hidden="true" draggable={false} className={className} />
}

export function EditorIcon({ preset, className }: { preset: EditorPreset; className?: string }) {
  switch (preset) {
    case "xcode":
      return <AppIcon src={ICON_SRC.xcode} className={className} />
    case "windsurf":
      return <AppIcon src={ICON_SRC.windsurf} className={className} />
    case "custom":
      return <AppIcon src={ICON_SRC.custom} className={className} />
    case "cursor":
    case "vscode":
    default:
      return <AppIcon src={ICON_SRC.cursor} className={className} />
  }
}

export function FinderIcon({ className }: { className?: string }) {
  return <AppIcon src={ICON_SRC.finder} className={className} />
}

export function FolderFallbackIcon({ className }: { className?: string }) {
  return <FolderOpen className={className} />
}

export function TerminalIcon({ className }: { className?: string }) {
  return <AppIcon src={ICON_SRC.terminal} className={className} />
}
