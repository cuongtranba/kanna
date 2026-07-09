import { memo, useState } from "react"
import { Sparkles, ChevronRight } from "lucide-react"
import { cn } from "../../lib/utils"
import { renderMarkdownToReact } from "../lexical/markdown/lexicalToReact"
import type { ProcessedAdvisorMessage } from "./types"

interface Props {
  message: ProcessedAdvisorMessage
}

export const AdvisorMessage = memo(function AdvisorMessage({ message }: Props) {
  const [expanded, setExpanded] = useState(false)
  const trimmed = message.text.trim()
  if (trimmed.length === 0) return null

  return (
    <div className="px-0.5 w-full max-w-[70ch] my-3 first:mt-0 last:mb-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="group/advisor flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="font-medium uppercase tracking-wider">Advisor</span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            expanded && "rotate-90"
          )}
        />
      </button>
      {expanded && (
        <div className="mt-2 border-l-2 border-muted-foreground/20 pl-3 text-sm text-muted-foreground italic prose prose-sm dark:prose-invert max-w-[70ch]">
          {renderMarkdownToReact(trimmed)}
        </div>
      )}
    </div>
  )
})
