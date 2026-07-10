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

        let handled = false
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
          // Remove the shortcut token; caret lands at `start`.
          node.spliceText(start, token.length, "", true)

          const afterSelection = $getSelection()
          if (!$isRangeSelection(afterSelection)) return

          const parts = snippet.expansion.split("\n")
          parts.forEach((part, index) => {
            if (index > 0) afterSelection.insertLineBreak()
            if (part.length > 0) afterSelection.insertText(part)
          })

          handled = true
        })

        if (handled) {
          event.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_LOW,
    )
  }, [editor, snippets])

  return null
}
