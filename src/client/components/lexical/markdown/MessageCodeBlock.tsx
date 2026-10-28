import { useCallback } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import { runDetached } from "../../../lib/runDetached"
import { HighlightedCode } from "../../messages/HighlightedCode"
import { useCopyFeedback, type CopyFeedbackPorts } from "../../../stores/copyFeedbackStore"

export function MessageCodeBlock({
  source,
  lang,
  ports,
}: {
  source: string
  lang: string
  ports?: CopyFeedbackPorts
}) {
  const { copied, copy } = useCopyFeedback(ports)
  const handleCopy = useCallback(() => { runDetached("copy code block", copy(source)) }, [copy, source])

  return (
    <div className="relative overflow-x-auto max-w-full min-w-0 no-code-highlight group/pre">
      <pre className="min-w-0 rounded-xl py-2.5 px-3.5">
        {lang ? (
          <HighlightedCode source={source} lang={lang} />
        ) : (
          <code className="block text-xs whitespace-pre">{source}</code>
        )}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        aria-label={copied ? "Copied" : "Copy code"}
        className={cn(
          "absolute top-[35px] -translate-y-[50%] -translate-x-[1px] rounded-md right-1.5 h-11 w-11 md:h-8 md:w-8 text-muted-foreground opacity-100 md:opacity-0 md:group-hover/pre:opacity-100 transition-opacity [@media(hover:none)]:!opacity-100",
          !copied && "hover:text-foreground",
          copied && "hover:!bg-transparent hover:!border-transparent",
        )}
        onClick={handleCopy}
      >
        {copied ? <Check className="h-4 w-4 text-success-text" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
