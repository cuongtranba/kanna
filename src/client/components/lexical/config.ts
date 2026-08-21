import type { EditorThemeClasses, Klass, LexicalNode } from "lexical"

// Heading className map, triplicated (deliberately, see renderMessage.tsx's
// file header) across this file, markdown/renderMessage.tsx and
// markdown/lexicalToReact.tsx. src/client/components/lexical/headingClassMap.test.ts
// pins all three copies equal to each other so they cannot silently drift.
// Uses the --text-N tokens (src/index.css @theme) instead of arbitrary
// text-[Npx] utilities so headings respond to --kanna-font-scale.
export const HEADING_CLASS_MAP: Record<string, string> = {
  h1: "text-20 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h2: "text-18 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h3: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h4: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h5: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
  h6: "text-16 font-normal leading-tight mt-5 mb-3 first:mt-0 last:mb-0",
}

// Maps Lexical node types to Tailwind class strings. Values mirror the
// existing prose/markdown styling from messages/shared.tsx so the
// headless-rendered output matches the legacy react-markdown look.
export const kannaEditorTheme: EditorThemeClasses = {
  paragraph: "break-words mt-5 mb-3 first:mt-0 last:mb-0",
  quote: "my-2 mt-5 mb-3 first:mt-0 last:mb-0 border-l-2 border-border/80 pl-2 text-muted-foreground",
  heading: HEADING_CLASS_MAP,
  list: {
    ul: "list-disc ml-5 my-2",
    ol: "list-decimal ml-5 my-2",
    listitem: "my-0.5",
    nested: { listitem: "list-none" },
  },
  link: "text-primary underline underline-offset-2",
  text: {
    bold: "font-semibold",
    italic: "italic",
    strikethrough: "line-through",
    code: "break-all px-1 bg-border/60 py-0.5 rounded text-sm",
  },
  code: "block text-xs whitespace-pre",
}

// onError handler: rethrow so Lexical update failures surface in dev/test
// instead of silently corrupting editor state.
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
