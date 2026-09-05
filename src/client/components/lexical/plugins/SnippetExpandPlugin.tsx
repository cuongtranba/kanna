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


export interface SnippetExpandPluginProps {
  snippets: readonly TextSnippet[]
}


const TRAILING_TOKEN_RE = /(\S+)$/

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


export interface TabKeyLike {
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly repeat: boolean
}

export type TabDecision = "ignore" | "swallow-repeat" | "attempt"

export function decideTab(
  event: TabKeyLike,
  menuOpen: boolean,
  snippetCount: number,
  lastPressExpanded: boolean,
): TabDecision {
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return "ignore"
  if (event.repeat) return lastPressExpanded ? "swallow-repeat" : "ignore"
  if (menuOpen) return "ignore"
  if (snippetCount === 0) return "ignore"
  return "attempt"
}


export function SnippetExpandPlugin({ snippets }: SnippetExpandPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    let lastPressExpanded = false

    return editor.registerCommand(
      KEY_TAB_COMMAND,
      (event: KeyboardEvent) => {
        const decision = decideTab(event, isTypeaheadMenuOpen(), snippets.length, lastPressExpanded)
        if (!event.repeat) lastPressExpanded = false
        if (decision === "ignore") return false
        if (decision === "swallow-repeat") {
          event.preventDefault()
          return true
        }

        const willExpand = editor.getEditorState().read(() => {
          const selection = $getSelection()
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
          const node = selection.anchor.getNode()
          if (!$isTextNode(node)) return false
          const textBeforeCaret = node.getTextContent().slice(0, selection.anchor.offset)
          return findSnippetForCaret(textBeforeCaret, snippets) !== null
        })
        if (!willExpand) return false

        lastPressExpanded = true
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
