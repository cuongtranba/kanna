import { renderMarkdownBlocks } from "../../../lexical/markdown/renderMessage"
import { useTextBodyContent } from "./textLoader"
import { TextBodyFrame } from "./TextBodyFrame"
import type { PreviewSource } from "../types"

export function MarkdownBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  return (
    <TextBodyFrame state={state} shell={<div className="prose hidden" />}>
      {(content) => (
        <div className="prose prose-sm prose-invert max-w-none rounded-xl border border-border bg-background p-4">
          {renderMarkdownBlocks(content)}
        </div>
      )}
    </TextBodyFrame>
  )
}
