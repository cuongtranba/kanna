import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  $getRoot,
  $createParagraphNode,
} from "lexical"
import { serializeEditorToWire, type WirePayload } from "../serialize/editorToWireString"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Alias: the same shape returned by serializeEditorToWire. */
export type SubmitPayload = WirePayload

export interface SubmitPluginProps {
  onSubmit: (payload: SubmitPayload) => void
  disabled: boolean
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
export function SubmitPlugin({ onSubmit, disabled }: SubmitPluginProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (disabled) return false
        if (!event) return false

        // Shift+Enter → insert newline; do not intercept.
        if (event.shiftKey) return false

        // Touch devices: allow the OS keyboard's Return key to insert newlines.
        const isTouchDevice =
          typeof window !== "undefined" &&
          ("ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0))
        if (isTouchDevice) return false

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
  }, [editor, disabled, onSubmit])

  return null
}
