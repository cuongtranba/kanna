import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_TAB_COMMAND,
} from "lexical"
import type { TextSnippet } from "../../../../shared/types"
import { isTypeaheadMenuOpen } from "./SubmitPlugin"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SnippetExpandPluginProps {
  snippets: readonly TextSnippet[]
}

// ---------------------------------------------------------------------------
// Matching (pure — exported for tests)
// ---------------------------------------------------------------------------

const TRAILING_TOKEN_RE = /(\S+)$/

/**
 * Returns the snippet whose `shortcut` equals the trailing whitespace-free
 * token immediately before the caret, or null when nothing matches.
 */
export function findSnippetForCaret(
  textBeforeCaret: string,
  snippets: readonly TextSnippet[],
): TextSnippet | null {
  const match = TRAILING_TOKEN_RE.exec(textBeforeCaret)
  if (match === null) return null
  const token = match[1]
  for (const snippet of snippets) {
    if (snippet.shortcut === token) return snippet
  }
  return null
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Expands a text snippet when the user presses Tab after a matching shortcut.
 *
 *   – Plain Tab, caret after a shortcut token → replace the token in place
 *   – Shift/Ctrl/Meta/Alt+Tab                 → ignored (plan-mode toggle etc.)
 *   – A typeahead picker (@ / /) open          → ignored
 *   – No matching shortcut                     → ignored (browser default Tab)
 *
 * Multi-line expansions insert soft line breaks between segments.
 */
export function SnippetExpandPlugin({ snippets }: SnippetExpandPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
        if (isTypeaheadMenuOpen()) return false
        if (snippets.length === 0) return false

        // Decide synchronously whether a snippet will expand, then
        // preventDefault BEFORE the mutation. `editor.update` defers its
        // callback whenever a command is already dispatching: KEY_TAB_COMMAND
        // fires inside an active update (`editor._updating === true`), so
        // `updateEditor` queues our callback instead of running it inline
        // (LexicalUpdates.ts). If we gated preventDefault on a flag the
        // callback sets, the flag would still be false when we check it, Tab's
        // default focus traversal would move focus to the next control (the
        // Send button), and the caret would vanish from the composer even
        // though the text expanded a tick later. A synchronous state read lets
        // us preventDefault up front and keep focus in the editor.
        const willExpand = editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
          const node = selection.anchor.getNode()
          if (!$isTextNode(node)) return false
          const textBeforeCaret = node.getTextContent().slice(0, selection.anchor.offset)
          return findSnippetForCaret(textBeforeCaret, snippets) !== null
        })
        if (!willExpand) return false

        event.preventDefault()

        editor.update(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return

          const anchor = selection.anchor
          const node = anchor.getNode()
          if (!$isTextNode(node)) return

          const offset = anchor.offset
          const textBeforeCaret = node.getTextContent().slice(0, offset)
          const match = TRAILING_TOKEN_RE.exec(textBeforeCaret)
          if (match === null) return

          const snippet = findSnippetForCaret(textBeforeCaret, snippets)
          if (snippet === null) return

          const token = match[1]
          const start = offset - token.length
          const parts = snippet.expansion.split("\n")

          // Splice the token straight to the first expansion line so the node
          // is never emptied (an empty TextNode gets pruned during DOM
          // reconciliation). `spliceText(..., true)` lands the caret at the end
          // of the inserted first line.
          node.spliceText(start, token.length, parts[0] ?? "", true)

          if (parts.length > 1) {
            const afterSelection = $getSelection()
            if (!$isRangeSelection(afterSelection)) return
            for (let index = 1; index < parts.length; index += 1) {
              afterSelection.insertLineBreak()
              const line = parts[index]
              if (line.length > 0) afterSelection.insertText(line)
            }
          }
        })

        return true
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, snippets])

  return null
}
