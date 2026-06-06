import { FileText } from "lucide-react"
import type { ProcessedMemoryLoadedMessage } from "./types"

interface Props {
  message: ProcessedMemoryLoadedMessage
}

/**
 * Quiet single-line transcript row for a Claude Code memory/rule file that was
 * auto-loaded into context ("Loaded CLAUDE.md", "Loaded .claude/rules/*.md").
 * PTY-only; emitted from the transcript's `nested_memory` lines. Low-emphasis
 * by design — Margin Gray muted, mono path with the directory dimmed and the
 * filename carrying the weight, so a wall of rule loads stays legible.
 */
export function MemoryLoadedMessage({ message }: Props) {
  const lastSlash = message.path.lastIndexOf("/")
  const dir = lastSlash >= 0 ? message.path.slice(0, lastSlash + 1) : ""
  const base = lastSlash >= 0 ? message.path.slice(lastSlash + 1) : message.path

  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
      <span className="text-xs">Loaded</span>
      <span className="min-w-0 truncate font-mono text-xs">
        {dir ? <span className="opacity-60">{dir}</span> : null}
        <span className="text-foreground/70">{base}</span>
      </span>
    </div>
  )
}
