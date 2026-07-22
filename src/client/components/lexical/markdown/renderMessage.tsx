/**
 * Message-level markdown renderer with:
 *  - ThinkingBlock support (pre-pass: split <think>…</think> segments)
 *  - MermaidNode, LocalFileLinkNode support (custom DecoratorNode handling)
 *
 * Public API:
 *   renderMessageMarkdown(text: string): ReactNode  (one-shot)
 *   useRenderedMessage(text: string): ReactNode     (memoised hook)
 *
 * Design rationale:
 *   lexicalToReact.tsx's walker handles the standard GFM node set but has no
 *   branch for custom DecoratorNodes (MermaidNode, LocalFileLinkNode). Rather
 *   than editing lexicalToReact.tsx (owned by another agent), this module
 *   implements its own headless walk that delegates to node.decorate() for
 *   DecoratorNodes and falls back to the shared text/element rendering for
 *   everything else. The approach keeps the two walkers in sync with only the
 *   custom-node branch added here.
 */

import { useMemo, type ReactNode } from "react"
import { createHeadlessEditor } from "@lexical/headless"
import { $convertFromMarkdownString } from "@lexical/markdown"
import {
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text"
import { $isListItemNode, $isListNode, ListItemNode, ListNode } from "@lexical/list"
import { $isLinkNode, $isAutoLinkNode, AutoLinkNode, LinkNode } from "@lexical/link"
import { $isCodeNode, $isCodeHighlightNode, CodeNode, CodeHighlightNode } from "@lexical/code"
import {
  $isTableNode,
  $isTableRowNode,
  $isTableCellNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table"
import {
  $getRoot,
  $isParagraphNode,
  $isTextNode,
  $isLineBreakNode,
  IS_BOLD,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_CODE,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  TextNode,
} from "lexical"
import { buildKannaEditorConfig } from "../config"
import { parseThinkingSegments } from "../../../lib/parseThinking"
import { linkifyTextRefs } from "../../../lib/linkifyTextRefs"
import { ThinkingBlock } from "../../messages/ThinkingBlock"
import {
  $isMermaidNode,
  $isLocalFileLinkNode,
  KANNA_MESSAGE_NODES,
} from "../nodes"
import { KANNA_MESSAGE_TRANSFORMERS } from "./messageTransformers"
import { MessageCodeBlock } from "./MessageCodeBlock"

// ---------------------------------------------------------------------------
// Node set: GFM built-ins + custom message nodes
// ---------------------------------------------------------------------------

const MESSAGE_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  AutoLinkNode,
  TableNode,
  TableRowNode,
  TableCellNode,
  ...KANNA_MESSAGE_NODES,
]

// ---------------------------------------------------------------------------
// Node walker — mirrors lexicalToReact.tsx + adds DecoratorNode handling
// ---------------------------------------------------------------------------

/** Unique key counter per render pass. */
let keyCounter = 0
function nextKey(): string {
  return String(keyCounter++)
}

/** Current editor/config set at the start of each render pass. */
let renderEditor: LexicalEditor | null = null
let renderConfig: EditorConfig | null = null

/** Walk a single Lexical node and return its React representation. */
function walkNode(node: LexicalNode): ReactNode {
  // --- MermaidNode (DecoratorNode, block) ---
  if ($isMermaidNode(node) && renderEditor && renderConfig) {
    return <span key={nextKey()}>{node.decorate(renderEditor, renderConfig)}</span>
  }

  // --- LocalFileLinkNode (DecoratorNode, inline) ---
  if ($isLocalFileLinkNode(node) && renderEditor && renderConfig) {
    return <span key={nextKey()}>{node.decorate(renderEditor, renderConfig)}</span>
  }

  // --- Heading ---
  if ($isHeadingNode(node)) {
    const tag = node.getTag()
    const children = walkChildren(node)
    const classMap: Record<string, string> = {
      h1: "text-[20px] font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
      h2: "text-[18px] font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
      h3: "text-[16px] font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
      h4: "text-[16px] font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
      h5: "text-[16px] font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
      h6: "text-[16px] font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
    }
    const cls = classMap[tag] ?? classMap.h1
    const k = nextKey()
    switch (tag) {
      case "h1": return <h1 key={k} className={cls}>{children}</h1>
      case "h2": return <h2 key={k} className={cls}>{children}</h2>
      case "h3": return <h3 key={k} className={cls}>{children}</h3>
      case "h4": return <h4 key={k} className={cls}>{children}</h4>
      case "h5": return <h5 key={k} className={cls}>{children}</h5>
      default:   return <h6 key={k} className={cls}>{children}</h6>
    }
  }

  // --- Blockquote ---
  if ($isQuoteNode(node)) {
    return (
      <blockquote
        key={nextKey()}
        className="my-2 mt-5 mb-3 first:mt-0 last:mb-0 border-l-2 border-border/80 pl-2 text-muted-foreground"
      >
        {walkChildren(node)}
      </blockquote>
    )
  }

  // --- Paragraph ---
  if ($isParagraphNode(node)) {
    return (
      <p key={nextKey()} className="break-words mt-5 mb-3 first:mt-0 last:mb-0">
        {walkChildren(node)}
      </p>
    )
  }

  // --- Code block (fenced) ---
  if ($isCodeNode(node)) {
    const lang = node.getLanguage() ?? ""
    const code = node
      .getChildren<LexicalNode>()
      .map((child) => {
        if ($isTextNode(child) || $isCodeHighlightNode(child)) {
          return child.getTextContent()
        }
        if ($isLineBreakNode(child)) return "\n"
        return ""
      })
      .join("")

    return <MessageCodeBlock key={nextKey()} source={code} lang={lang} />
  }

  // --- List ---
  if ($isListNode(node)) {
    const listType = node.getListType()
    const children = walkChildren(node)
    const k = nextKey()
    if (listType === "number") {
      return (
        <ol key={k} className="list-decimal ml-5 my-2">
          {children}
        </ol>
      )
    }
    return (
      <ul key={k} className="list-disc ml-5 my-2">
        {children}
      </ul>
    )
  }

  // --- List item ---
  if ($isListItemNode(node)) {
    const checked = node.getChecked()
    const children = walkChildren(node)
    const k = nextKey()
    if (checked !== undefined) {
      return (
        <li key={k} className="my-0.5 list-none flex items-start gap-1.5">
          <input type="checkbox" readOnly checked={checked} className="mt-[3px] shrink-0" />
          <span>{children}</span>
        </li>
      )
    }
    return (
      <li key={k} className="my-0.5">
        {children}
      </li>
    )
  }

  // --- Link ---
  if ($isLinkNode(node) || $isAutoLinkNode(node)) {
    const url = node.getURL()
    return (
      <a
        key={nextKey()}
        href={url}
        className="transition-all underline decoration-2 text-logo decoration-logo/50 hover:text-logo/70 dark:text-logo dark:decoration-logo/70 dark:hover:text-logo/60 dark:hover:decoration-logo/40"
        target="_blank"
        rel="noopener noreferrer"
      >
        {walkChildren(node)}
      </a>
    )
  }

  // --- Table ---
  if ($isTableNode(node)) {
    const rows = node.getChildren<TableRowNode>()
    const firstRow = rows[0]
    const isFirstRowHeader =
      firstRow !== undefined &&
      $isTableRowNode(firstRow) &&
      firstRow.getChildren<TableCellNode>().every(
        (cell) =>
          $isTableCellNode(cell) &&
          (cell.getHeaderStyles() & TableCellHeaderStates.ROW) !== 0,
      )

    const headerRow = isFirstRowHeader ? firstRow : undefined
    const bodyRows = isFirstRowHeader ? rows.slice(1) : rows

    return (
      <div key={nextKey()} className="border border-border rounded-xl overflow-x-auto">
        <table className="table-auto min-w-full divide-y divide-border bg-background">
          {headerRow !== undefined && (
            <thead>
              <tr>
                {headerRow.getChildren<TableCellNode>().map((cell) => (
                  <th
                    key={nextKey()}
                    className="text-left text-xs uppercase text-muted-foreground tracking-wider p-2 pl-0 first:pl-3 bg-muted dark:bg-card [&_*]:font-semibold"
                  >
                    {walkChildren(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-border">
            {bodyRows.map((row) => {
              if (!$isTableRowNode(row)) return null
              return (
                <tr key={nextKey()}>
                  {row.getChildren<TableCellNode>().map((cell) => {
                    if (!$isTableCellNode(cell)) return null
                    return (
                      <td
                        key={nextKey()}
                        className="text-left p-2 pl-0 first:pl-3 [&_*]:font-normal"
                      >
                        {walkChildren(cell)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // --- Line break ---
  if ($isLineBreakNode(node)) {
    return <br key={nextKey()} />
  }

  // --- Text node (with format flags) ---
  if ($isTextNode(node)) {
    return renderTextNode(node)
  }

  // --- Code highlight node ---
  if ($isCodeHighlightNode(node)) {
    return (
      <code
        key={nextKey()}
        className="break-all px-1 bg-border/60 py-0.5 rounded text-sm"
      >
        {node.getTextContent()}
      </code>
    )
  }

  // Fallback: text content
  const fallbackText = node.getTextContent()
  return fallbackText ? <span key={nextKey()}>{fallbackText}</span> : null
}

/** Render a TextNode applying all its format flags. */
function renderTextNode(node: TextNode): ReactNode {
  const fmt = node.getFormat()
  const text = node.getTextContent()

  const isBold       = (fmt & IS_BOLD) !== 0
  const isItalic     = (fmt & IS_ITALIC) !== 0
  const isStrike     = (fmt & IS_STRIKETHROUGH) !== 0
  const isInlineCode = (fmt & IS_CODE) !== 0

  if (isInlineCode) {
    return (
      <code key={nextKey()} className="break-all px-1 bg-border/60 py-0.5 rounded text-sm">
        {text}
      </code>
    )
  }

  let content: ReactNode = text
  if (isStrike)  content = <del key={nextKey()} className="line-through">{content}</del>
  if (isItalic)  content = <em key={nextKey()} className="italic">{content}</em>
  if (isBold)    content = <strong key={nextKey()} className="font-semibold">{content}</strong>

  if (!isBold && !isItalic && !isStrike) return text
  return content
}

/** Walk an element node's children and return an array of ReactNodes. */
function walkChildren(node: { getChildren<T extends LexicalNode>(): T[] }): ReactNode[] {
  return node.getChildren<LexicalNode>().map(walkNode)
}

// ---------------------------------------------------------------------------
// Message-segment rendering
// ---------------------------------------------------------------------------

/**
 * Render a single markdown text segment (no <think> tags) through the Lexical
 * headless editor using KANNA_MESSAGE_TRANSFORMERS and the custom node set.
 */
function renderMarkdownSegment(markdown: string): ReactNode {
  const processed = linkifyTextRefs(markdown)
  const editorConfig = buildKannaEditorConfig({
    namespace: "kanna-message-renderer",
    nodes: MESSAGE_NODES,
    editable: false,
  })
  const editor = createHeadlessEditor(editorConfig)

  editor.update(() => {
    $convertFromMarkdownString(processed, KANNA_MESSAGE_TRANSFORMERS, undefined, true)
  }, { discrete: true })

  return editor.getEditorState().read(() => {
    keyCounter = 0
    renderEditor = editor
    renderConfig = editorConfig
    const root = $getRoot()
    const children = root.getChildren<LexicalNode>()
    const result = <>{children.map(walkNode)}</>
    renderEditor = null
    renderConfig = null
    return result
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a standalone markdown document (e.g. a previewed .md file) to a
 * React tree with the full message transformer set — mermaid fences become
 * MermaidDiagram blocks, GFM tables/lists/code render as in chat messages.
 * No <think>-segment pre-pass: file content is not an assistant message.
 */
export function renderMarkdownDocument(markdown: string): ReactNode {
  return renderMarkdownSegment(markdown)
}

/**
 * Render an assistant message text to a React tree.
 *
 * Pre-pass: splits out `<think>…</think>` segments using parseThinkingSegments.
 * For each "thinking" segment, renders a ThinkingBlock component.
 * For each "text" segment, parses markdown via the Lexical headless engine.
 *
 * @param text - Raw assistant message text (may contain <think> blocks and markdown).
 */
export function renderMessageMarkdown(text: string): ReactNode {
  const segments = parseThinkingSegments(text)

  const nodes = segments.map((seg, i) => {
    if (seg.kind === "thinking") {
      return <ThinkingBlock key={`think-${i}`} content={seg.content} />
    }
    const rendered = renderMarkdownSegment(seg.content)
    return <span key={`text-${i}`}>{rendered}</span>
  })

  return <>{nodes}</>
}

/**
 * React hook that memoises the rendered React tree by text string.
 * Suitable for function components — cheap on re-renders when text hasn't changed.
 */
export function useRenderedMessage(text: string): ReactNode {
  return useMemo(() => renderMessageMarkdown(text), [text])
}
