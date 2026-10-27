import { useTextBodyContent } from "./textLoader"
import { PREVIEW_PRE_CLASS, TextBodyFrame } from "./TextBodyFrame"
import type { PreviewSource } from "../types"

export function TextBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  return (
    <TextBodyFrame state={state} shell={<pre className="sr-only" />}>
      {(content) => <pre className={PREVIEW_PRE_CLASS}>{content}</pre>}
    </TextBodyFrame>
  )
}
