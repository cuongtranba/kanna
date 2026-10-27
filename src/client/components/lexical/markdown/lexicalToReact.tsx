import { Fragment, type ReactNode } from "react"
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
  $isDecoratorNode,
  $isParagraphNode,
  $isTextNode,
  $isLineBreakNode,
  IS_BOLD,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_CODE,
  type DecoratorNode,
  type EditorConfig,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  TextNode,
} from "lexical"
import { KANNA_BUILTIN_TRANSFORMERS } from "./gfmTransformers"
import { KANNA_UI_FENCE, KANNA_UI_INTENT_FENCE } from "./kannaUiTransformers"
import { KannaUiNode } from "../nodes/KannaUiNode"
import { buildKannaEditorConfig, HEADING_CLASS_MAP, MARKDOWN_CLASSES } from "../config"
import { MessageCodeBlock } from "./MessageCodeBlock"

const LINK_CLASS = "transition-colors underline decoration-2 text-logo decoration-logo/50 hover:text-logo/70 dark:text-logo dark:decoration-logo/70 dark:hover:text-logo/60 dark:hover:decoration-logo/40"

export const MARKDOWN_BASE_NODES: ReadonlyArray<Klass<LexicalNode>> = [
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

export interface MarkdownDialect {
  namespace: string
  nodes: ReadonlyArray<Klass<LexicalNode>>
  transformers: Array<Transformer>
}

const PLAIN_MARKDOWN_DIALECT: MarkdownDialect = {
  namespace: "kanna-md-renderer",
  nodes: [...MARKDOWN_BASE_NODES, KannaUiNode],
  transformers: [KANNA_UI_INTENT_FENCE, KANNA_UI_FENCE, ...KANNA_BUILTIN_TRANSFORMERS],
}

export interface CaretOptions {
  ghostLength: number
  renderTail: (ghost: string) => ReactNode
}

interface CaretTarget extends CaretOptions {
  key: string
}

interface RenderContext {
  nextKey: () => string
  editor: LexicalEditor
  config: EditorConfig
  caret: CaretTarget | null
}

function headingElement(tag: string, key: string, children: ReactNode[]): ReactNode {
  switch (tag) {
    case "h1": return <h1 key={key} className={HEADING_CLASS_MAP.h1}>{children}</h1>
    case "h2": return <h2 key={key} className={HEADING_CLASS_MAP.h2}>{children}</h2>
    case "h3": return <h3 key={key} className={HEADING_CLASS_MAP.h3}>{children}</h3>
    case "h4": return <h4 key={key} className={HEADING_CLASS_MAP.h4}>{children}</h4>
    case "h5": return <h5 key={key} className={HEADING_CLASS_MAP.h5}>{children}</h5>
    case "h6": return <h6 key={key} className={HEADING_CLASS_MAP.h6}>{children}</h6>
    default:   return <h6 key={key} className={HEADING_CLASS_MAP.h1}>{children}</h6>
  }
}

function codeNodeSource(node: CodeNode): string {
  return node
    .getChildren<LexicalNode>()
    .map((child) => {
      if ($isTextNode(child) || $isCodeHighlightNode(child)) {
        return child.getTextContent()
      }
      if ($isLineBreakNode(child)) return "\n"
      return ""
    })
    .join("")
}

function isHeaderRow(row: LexicalNode | undefined): row is TableRowNode {
  return (
    row !== undefined &&
    $isTableRowNode(row) &&
    row.getChildren<TableCellNode>().every(
      (cell) =>
        $isTableCellNode(cell) &&
        (cell.getHeaderStyles() & TableCellHeaderStates.ROW) !== 0,
    )
  )
}

function renderTable(node: TableNode, ctx: RenderContext): ReactNode {
  const rows = node.getChildren<TableRowNode>()
  const firstRow = rows[0]
  const headerRow = isHeaderRow(firstRow) ? firstRow : undefined
  const bodyRows = headerRow === undefined ? rows : rows.slice(1)

  return (
    <div key={ctx.nextKey()} className="border border-border rounded-xl overflow-x-auto">
      <table className="table-auto min-w-full divide-y divide-border bg-background">
        {headerRow !== undefined && (
          <thead>
            <tr>
              {headerRow.getChildren<TableCellNode>().map((cell) => (
                <th
                  key={ctx.nextKey()}
                  className="text-left text-xs text-muted-foreground tracking-wider p-2 pl-0 first:pl-3 bg-muted dark:bg-card [&_*]:font-semibold"
                >
                  {walkChildren(cell, ctx)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y divide-border">
          {bodyRows.map((row) => {
            if (!$isTableRowNode(row)) return null
            return (
              <tr key={ctx.nextKey()}>
                {row.getChildren<TableCellNode>().map((cell) => {
                  if (!$isTableCellNode(cell)) return null
                  return (
                    <td
                      key={ctx.nextKey()}
                      className="text-left p-2 pl-0 first:pl-3 [&_*]:font-normal"
                    >
                      {walkChildren(cell, ctx)}
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

function renderListItem(node: ListItemNode, ctx: RenderContext): ReactNode {
  const checked = node.getChecked()
  const children = walkChildren(node, ctx)
  const key = ctx.nextKey()
  if (checked !== undefined) {
    return (
      <li key={key} className="my-0.5 list-none flex items-start gap-1.5">
        <input type="checkbox" readOnly checked={checked} className="mt-[3px] shrink-0" />
        <span>{children}</span>
      </li>
    )
  }
  return <li key={key} className={MARKDOWN_CLASSES.listitem}>{children}</li>
}

function isReactDecorator(node: LexicalNode): node is DecoratorNode<ReactNode> {
  return $isDecoratorNode(node)
}

function walkNode(node: LexicalNode, ctx: RenderContext): ReactNode {
  if (isReactDecorator(node)) {
    return <span key={ctx.nextKey()}>{node.decorate(ctx.editor, ctx.config)}</span>
  }

  if ($isHeadingNode(node)) {
    const children = walkChildren(node, ctx)
    return headingElement(node.getTag(), ctx.nextKey(), children)
  }

  if ($isQuoteNode(node)) {
    return (
      <blockquote key={ctx.nextKey()} className={MARKDOWN_CLASSES.quote}>
        {walkChildren(node, ctx)}
      </blockquote>
    )
  }

  if ($isParagraphNode(node)) {
    return (
      <p key={ctx.nextKey()} className={MARKDOWN_CLASSES.paragraph}>
        {walkChildren(node, ctx)}
      </p>
    )
  }

  if ($isCodeNode(node)) {
    return <MessageCodeBlock key={ctx.nextKey()} source={codeNodeSource(node)} lang={node.getLanguage() ?? ""} />
  }

  if ($isListNode(node)) {
    const children = walkChildren(node, ctx)
    const key = ctx.nextKey()
    if (node.getListType() === "number") {
      return <ol key={key} className={MARKDOWN_CLASSES.ol}>{children}</ol>
    }
    return <ul key={key} className={MARKDOWN_CLASSES.ul}>{children}</ul>
  }

  if ($isListItemNode(node)) {
    return renderListItem(node, ctx)
  }

  if ($isLinkNode(node) || $isAutoLinkNode(node)) {
    return (
      <a
        key={ctx.nextKey()}
        href={node.getURL()}
        className={LINK_CLASS}
        target="_blank"
        rel="noopener noreferrer"
      >
        {walkChildren(node, ctx)}
      </a>
    )
  }

  if ($isTableNode(node)) {
    return renderTable(node, ctx)
  }

  if ($isLineBreakNode(node)) {
    return <br key={ctx.nextKey()} />
  }

  if ($isTextNode(node)) {
    return renderTextNode(node, ctx)
  }

  if ($isCodeHighlightNode(node)) {
    return (
      <code key={ctx.nextKey()} className={MARKDOWN_CLASSES.inlineCode}>
        {node.getTextContent()}
      </code>
    )
  }

  const fallbackText = node.getTextContent()
  return fallbackText ? <span key={ctx.nextKey()}>{fallbackText}</span> : null
}

function withCaretTail(node: TextNode, text: string, ctx: RenderContext): ReactNode {
  const target = ctx.caret
  if (target === null || target.key !== node.getKey()) return text
  const ghostLength = Math.min(target.ghostLength, text.length)
  const splitAt = text.length - ghostLength
  return (
    <Fragment key={ctx.nextKey()}>
      {text.slice(0, splitAt)}
      {target.renderTail(text.slice(splitAt))}
    </Fragment>
  )
}

function renderTextNode(node: TextNode, ctx: RenderContext): ReactNode {
  const fmt = node.getFormat()
  let content: ReactNode = withCaretTail(node, node.getTextContent(), ctx)

  if ((fmt & IS_CODE) !== 0) {
    return <code key={ctx.nextKey()} className={MARKDOWN_CLASSES.inlineCode}>{content}</code>
  }

  if ((fmt & IS_STRIKETHROUGH) !== 0) content = <del key={ctx.nextKey()} className={MARKDOWN_CLASSES.strikethrough}>{content}</del>
  if ((fmt & IS_ITALIC) !== 0) content = <em key={ctx.nextKey()} className={MARKDOWN_CLASSES.italic}>{content}</em>
  if ((fmt & IS_BOLD) !== 0) content = <strong key={ctx.nextKey()} className={MARKDOWN_CLASSES.bold}>{content}</strong>

  return content
}

function walkChildren(node: { getChildren<T extends LexicalNode>(): T[] }, ctx: RenderContext): ReactNode[] {
  return node.getChildren<LexicalNode>().map((child) => walkNode(child, ctx))
}

function resolveCaretTarget(caret: CaretOptions | undefined): CaretTarget | null {
  if (caret === undefined) return null
  const last = $getRoot().getLastDescendant()
  if (!$isTextNode(last) || $isCodeHighlightNode(last)) return null
  return { ...caret, key: last.getKey() }
}

export function renderLexicalMarkdown(
  markdown: string,
  dialect: MarkdownDialect,
  caret?: CaretOptions,
): ReactNode[] {
  const config = buildKannaEditorConfig({
    namespace: dialect.namespace,
    nodes: dialect.nodes,
    editable: false,
  })
  const editor = createHeadlessEditor(config)

  editor.update(() => {
    $convertFromMarkdownString(markdown, dialect.transformers, undefined, true)
  }, { discrete: true })

  return editor.getEditorState().read(() => {
    let keyCounter = 0
    const ctx: RenderContext = {
      nextKey: () => String(keyCounter++),
      editor,
      config,
      caret: resolveCaretTarget(caret),
    }
    return walkChildren($getRoot(), ctx)
  })
}

export function renderMarkdownToReact(markdown: string): ReactNode {
  return <>{renderLexicalMarkdown(markdown, PLAIN_MARKDOWN_DIALECT)}</>
}
