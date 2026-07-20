import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  $getRoot,
  $createParagraphNode,
} from "lexical"
import { serializeEditorToWire, type WirePayload } from "../serialize/editorToWireString"
import type { DomPort } from "../../../ports/domPort"
import { domAdapter } from "../../../adapters/dom.adapter"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Alias: the same shape returned by serializeEditorToWire. */
export type SubmitPayload = WirePayload

export interface SubmitPluginProps {
  onSubmit: (payload: SubmitPayload) => void
  disabled: boolean
  /** Injectable DOM port (touch-device + typeahead-menu checks); defaults to the real adapter. */
  dom?: DomPort
}

// ---------------------------------------------------------------------------
// Typeahead guard
// ---------------------------------------------------------------------------

/**
 * True when a composer typeahead picker (mention `@` / slash `/`) is currently
 * open. Both pickers tag their menu `<ul>` with `data-kanna-typeahead-menu`.
 * SubmitPlugin runs at COMMAND_PRIORITY_HIGH; when a picker is open it must NOT
 * submit on Enter — it bails so the picker's lower-priority KEY_ENTER_COMMAND
 * handler can select the highlighted option instead.
 */
export function isTypeaheadMenuOpen(dom: Pick<DomPort, "hasTypeaheadMenuOpen"> = domAdapter): boolean {
  return dom.hasTypeaheadMenuOpen()
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Registers a KEY_ENTER_COMMAND handler that mirrors the legacy ChatInput
 * keyboard behaviour:
 *
 *   – Plain Enter (no modifier, not on touch device) → submit + clear
 *   – Shift+Enter                                    → insert newline (default)
 *   – When disabled                                  → noop
 *
 * The plugin uses COMMAND_PRIORITY_HIGH so it fires before the default
 * rich-text insertion handler; returning `true` prevents the default.
 */
export function SubmitPlugin({ onSubmit, disabled, dom = domAdapter }: SubmitPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (disabled) return false
        if (!event) return false

        // Shift+Enter → insert newline; do not intercept.
        if (event.shiftKey) return false

        // A typeahead picker (mention `@` / slash `/`) is open: let its own
        // lower-priority KEY_ENTER_COMMAND handler select the highlighted
        // option. This plugin runs at COMMAND_PRIORITY_HIGH, so returning
        // false here lets the event fall through to the typeahead instead of
        // submitting the raw trigger text.
        if (isTypeaheadMenuOpen(dom)) return false

        // Touch devices: allow the OS keyboard's Return key to insert newlines.
        if (dom.isTouchDevice()) return false

        // Check the editor has content worth sending.
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false

        // Prevent the default newline insertion.
        event.preventDefault()

        // Clear the editor before calling onSubmit (mirrors ChatInput behaviour
        // so the UI clears instantly even if onSubmit is async).
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          root.append($createParagraphNode())
        })

        onSubmit(payload)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, disabled, onSubmit, dom])

  return null
}
