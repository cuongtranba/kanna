
import { useMemo, type ReactNode } from "react"
import { createHeadlessEditor } from "@lexical/headless"
import {
  $convertFromMarkdownString,
  type Transformer,
} from "@lexical/markdown"
import {
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text"
import {
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list"
import {
  $isLinkNode,
  $isAutoLinkNode,
  AutoLinkNode,
  LinkNode,
} from "@lexical/link"
import {
  $isCodeNode,
  $isCodeHighlightNode,
  CodeNode,
  CodeHighlightNode,
} from "@lexical/code"
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
  type LexicalNode,
  TextNode,
} from "lexical"
import { KANNA_BUILTIN_TRANSFORMERS } from "./gfmTransformers"
import { buildKannaEditorConfig } from "../config"
import { MessageCodeBlock } from "./MessageCodeBlock"


const KANNA_NODES = [
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
]


let keyCounter = 0
function nextKey(): string {
  return String(keyCounter++)
}

export const HEADING_CLASS_MAP: Record<string, string> = {
  h1: "text-20 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h2: "text-18 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h3: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h4: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h5: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h6: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
}

function walkNode(node: LexicalNode): ReactNode {
  if ($isHeadingNode(node)) {
    const tag = node.getTag()
    const children = walkChildren(node)
    const cls = HEADING_CLASS_MAP[tag] ?? HEADING_CLASS_MAP.h1
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

  if ($isParagraphNode(node)) {
    return (
      <p key={nextKey()} className="break-words mt-5 mb-3 first:mt-0 last:mb-0">
        {walkChildren(node)}
      </p>
    )
  }

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

  if ($isListItemNode(node)) {
    const checked = node.getChecked()
    const children = walkChildren(node)
    const k = nextKey()
    if (checked !== undefined) {
      return (
        <li key={k} className="my-0.5 list-none flex items-start gap-1.5">
          <input
            type="checkbox"
            readOnly
            checked={checked}
            className="mt-[3px] shrink-0"
          />
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

  if ($isLinkNode(node) || $isAutoLinkNode(node)) {
    const url = node.getURL()
    return (
      <a
        key={nextKey()}
        href={url}
        className="transition-colors underline decoration-2 text-logo decoration-logo/50 hover:text-logo/70 dark:text-logo dark:decoration-logo/70 dark:hover:text-logo/60 dark:hover:decoration-logo/40"
        target="_blank"
        rel="noopener noreferrer"
      >
        {walkChildren(node)}
      </a>
    )
  }

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
                    className="text-left text-xs text-muted-foreground tracking-wider p-2 pl-0 first:pl-3 bg-muted dark:bg-card [&_*]:font-semibold"
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

  if ($isLineBreakNode(node)) {
    return <br key={nextKey()} />
  }

  if ($isTextNode(node)) {
    return renderTextNode(node)
  }

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

  const fallbackText = node.getTextContent()
  return fallbackText ? <span key={nextKey()}>{fallbackText}</span> : null
}

function renderTextNode(node: TextNode): ReactNode {
  const fmt = node.getFormat()
  const text = node.getTextContent()

  const isBold        = (fmt & IS_BOLD) !== 0
  const isItalic      = (fmt & IS_ITALIC) !== 0
  const isStrike      = (fmt & IS_STRIKETHROUGH) !== 0
  const isInlineCode  = (fmt & IS_CODE) !== 0

  let content: ReactNode = text

  if (isInlineCode) {
    return (
      <code key={nextKey()} className="break-all px-1 bg-border/60 py-0.5 rounded text-sm">
        {text}
      </code>
    )
  }

  if (isStrike) {
    content = <del key={nextKey()} className="line-through">{content}</del>
  }
  if (isItalic) {
    content = <em key={nextKey()} className="italic">{content}</em>
  }
  if (isBold) {
    content = <strong key={nextKey()} className="font-semibold">{content}</strong>
  }

  if (!isBold && !isItalic && !isStrike) {
    return text
  }

  return content
}

function walkChildren(node: { getChildren<T extends LexicalNode>(): T[] }): ReactNode[] {
  return node.getChildren<LexicalNode>().map(walkNode)
}


export function lexicalStateToReact(): ReactNode {
  keyCounter = 0
  const root = $getRoot()
  const children = root.getChildren<LexicalNode>()
  return <>{children.map(walkNode)}</>
}

export function renderMarkdownToReact(
  markdown: string,
  transformers: Array<Transformer> = KANNA_BUILTIN_TRANSFORMERS,
): ReactNode {
  const editor = createHeadlessEditor(
    buildKannaEditorConfig({
      namespace: "kanna-md-renderer",
      nodes: KANNA_NODES,
      editable: false,
    }),
  )

  editor.update(() => {
    $convertFromMarkdownString(markdown, transformers, undefined, true)
  }, { discrete: true })

  return editor.getEditorState().read(() => lexicalStateToReact())
}

export function useRenderedMarkdown(markdown: string): ReactNode {
  return useMemo(() => renderMarkdownToReact(markdown), [markdown])
}
