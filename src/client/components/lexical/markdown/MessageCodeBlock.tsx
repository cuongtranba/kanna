import { useCallback, useState } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import { HighlightedCode } from "../../messages/HighlightedCode"

// Fenced code block for rendered message bodies: shiki syntax highlighting via
// HighlightedCode plus a hover copy button. Mirrors the legacy PreBlock chrome
// from messages/shared.tsx so the Lexical headless render matches the prior
// react-markdown output.
export function MessageCodeBlock({ source, lang }: { source: string; lang: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(source)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [source])

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
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
