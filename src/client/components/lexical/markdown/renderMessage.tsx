import { useMemo, type ReactNode } from "react"
import type { LexicalNode } from "lexical"
import { parseThinkingSegments } from "../../../lib/parseThinking"
import { linkifyTextRefs } from "../../../lib/linkifyTextRefs"
import { ThinkingBlock } from "../../messages/ThinkingBlock"
import { LocalFileLinkCard } from "../../messages/LocalFileLinkCard"
import { $isLocalFileLinkNode } from "../nodes/LocalFileLinkNode"
import { KANNA_MESSAGE_NODES } from "../nodes"
import { KANNA_MESSAGE_TRANSFORMERS } from "./messageTransformers"
import { MARKDOWN_CLASSES } from "../config"
import {
  MARKDOWN_BASE_NODES,
  renderLexicalMarkdown,
  type CaretOptions,
  type MarkdownDialect,
} from "./lexicalToReact"

function renderMessageDecorator(node: LexicalNode): ReactNode | null {
  if (!$isLocalFileLinkNode(node)) return null
  const linkText = node.__line === undefined ? undefined : node.toHref()
  return <LocalFileLinkCard path={node.__path} linkText={linkText} />
}

const MESSAGE_MARKDOWN_DIALECT: MarkdownDialect = {
  namespace: "kanna-message-renderer",
  nodes: [...MARKDOWN_BASE_NODES, ...KANNA_MESSAGE_NODES],
  transformers: KANNA_MESSAGE_TRANSFORMERS,
  renderDecorator: renderMessageDecorator,
}

export function renderMarkdownBlocks(markdown: string): ReactNode {
  return <>{renderLexicalMarkdown(linkifyTextRefs(markdown), MESSAGE_MARKDOWN_DIALECT)}</>
}

export function renderMarkdownWithCaret(markdown: string, caret: CaretOptions): ReactNode {
  if (markdown.trim() === "") {
    return <p className={MARKDOWN_CLASSES.paragraph}>{caret.renderTail("")}</p>
  }
  return <>{renderLexicalMarkdown(linkifyTextRefs(markdown), MESSAGE_MARKDOWN_DIALECT, caret)}</>
}

export function renderMessageMarkdown(text: string): ReactNode {
  const segments = parseThinkingSegments(text)

  const nodes = segments.map((seg, i) => {
    if (seg.kind === "thinking") {
      return <ThinkingBlock key={`think-${i}`} content={seg.content} />
    }
    const rendered = renderMarkdownBlocks(seg.content)
    return <span key={`text-${i}`}>{rendered}</span>
  })

  return <>{nodes}</>
}

export function useRenderedMessage(text: string): ReactNode {
  return useMemo(() => renderMessageMarkdown(text), [text])
}
