import { useMemo } from "react"
import { prettifyJson } from "../../attachmentPreview"
import { useTextBodyContent } from "./textLoader"
import { PREVIEW_PRE_CLASS, TextBodyFrame } from "./TextBodyFrame"
import type { PreviewSource } from "../types"

export function JsonBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  const pretty = useMemo(() => (state.status === "ready" ? prettifyJson(state.content) : ""), [state])
  return (
    <TextBodyFrame state={state} shell={<pre className="sr-only" />}>
      {() => <pre className={PREVIEW_PRE_CLASS}>{pretty}</pre>}
    </TextBodyFrame>
  )
}
