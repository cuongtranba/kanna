import { withScopedStore } from "../../../../lib/createScopedStore"
import { useTextBodyContent } from "./textLoader"
import { PREVIEW_PRE_CLASS, TextBodyFrame } from "./TextBodyFrame"
import type { PreviewSource } from "../types"
import { ShikiHtmlStore } from "../../useShikiHtml.store"
import { shikiLangOfFileName, useShikiHtml } from "../../useShikiHtml"

function CodeBodyInner({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const ready = state.status === "ready"
  const html = useShikiHtml(ready ? state.content : "", ready ? shikiLangOfFileName(source.fileName) : null)

  if (ready && html !== null) {
    return <div className="overflow-x-auto p-3 text-xs" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return (
    <TextBodyFrame state={state} shell={<pre className="sr-only" />}>
      {(content) => <pre className={PREVIEW_PRE_CLASS}>{content}</pre>}
    </TextBodyFrame>
  )
}

export const CodeBody = withScopedStore(ShikiHtmlStore, CodeBodyInner)
