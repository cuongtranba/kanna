import { withScopedStore } from "../../lib/createScopedStore"
import { ShikiHtmlStore } from "./useShikiHtml.store"
import { resolveShikiLang, stripShikiWrappers, useShikiHtml } from "./useShikiHtml"

function HighlightedCodeInner({ source, lang }: { source: string; lang: string }) {
  const resolvedLang = resolveShikiLang(lang)
  const html = useShikiHtml(source, resolvedLang)
  const fallbackLang = resolvedLang ?? lang.toLowerCase()

  if (html !== null) {
    return (
      <code
        className={`block text-xs whitespace-pre language-${fallbackLang} shiki-highlighted`}
        dangerouslySetInnerHTML={{ __html: stripShikiWrappers(html) }}
      />
    )
  }
  return <code className={`block text-xs whitespace-pre language-${fallbackLang}`}>{source}</code>
}

export const HighlightedCode = withScopedStore(ShikiHtmlStore, HighlightedCodeInner)
