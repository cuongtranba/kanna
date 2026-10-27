import type { EditorThemeClasses, Klass, LexicalNode } from "lexical"

const HEADING_CLASS = "font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0"

export const HEADING_CLASS_MAP = {
  h1: `text-20 ${HEADING_CLASS}`,
  h2: `text-18 ${HEADING_CLASS}`,
  h3: `text-16 ${HEADING_CLASS}`,
  h4: `text-16 ${HEADING_CLASS}`,
  h5: `text-16 ${HEADING_CLASS}`,
  h6: `text-16 ${HEADING_CLASS}`,
} as const satisfies Record<string, string>

export const MARKDOWN_CLASSES = {
  paragraph: "break-words mt-5 mb-3 first:mt-0 last:mb-0",
  quote: "my-2 mt-5 mb-3 first:mt-0 last:mb-0 border-l-2 border-border/80 pl-2 text-muted-foreground",
  ul: "list-disc ml-5 my-2",
  ol: "list-decimal ml-5 my-2",
  listitem: "my-0.5",
  bold: "font-semibold",
  italic: "italic",
  strikethrough: "line-through",
  inlineCode: "break-all px-1 bg-border/60 py-0.5 rounded text-sm",
} as const

export const kannaEditorTheme: EditorThemeClasses = {
  paragraph: MARKDOWN_CLASSES.paragraph,
  quote: MARKDOWN_CLASSES.quote,
  heading: HEADING_CLASS_MAP,
  list: {
    ul: MARKDOWN_CLASSES.ul,
    ol: MARKDOWN_CLASSES.ol,
    listitem: MARKDOWN_CLASSES.listitem,
    nested: { listitem: "list-none" },
  },
  link: "text-primary underline underline-offset-2",
  text: {
    bold: MARKDOWN_CLASSES.bold,
    italic: MARKDOWN_CLASSES.italic,
    strikethrough: MARKDOWN_CLASSES.strikethrough,
    code: MARKDOWN_CLASSES.inlineCode,
  },
  code: "block text-xs whitespace-pre",
}

export function kannaEditorOnError(error: Error): void {
  throw error
}

export interface BuildKannaEditorConfigArgs {
  namespace: string
  nodes: ReadonlyArray<Klass<LexicalNode>>
  editable?: boolean
}

export function buildKannaEditorConfig(args: BuildKannaEditorConfigArgs) {
  return {
    namespace: args.namespace,
    theme: kannaEditorTheme,
    nodes: [...args.nodes],
    editable: args.editable ?? true,
    onError: kannaEditorOnError,
  }
}
