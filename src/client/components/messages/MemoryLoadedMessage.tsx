import { FileText } from "lucide-react"
import type { TranscriptMessageOf } from "../../../shared/types"
import { fileNameOfPath } from "../../lib/pathUtils"

interface Props {
  message: TranscriptMessageOf<"memory_loaded">
}

export function MemoryLoadedMessage({ message }: Props) {
  const base = fileNameOfPath(message.path)
  const dir = message.path.slice(0, message.path.lastIndexOf(base))

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
