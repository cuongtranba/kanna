import { useEffect, useRef } from "react"
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
 *   – Plain Enter on touch device with fine pointer  → submit + clear
 *     (iPad + Magic Keyboard / Universal Control where trackpad is primary)
 *   – Shift+Enter                                    → insert newline (default)
 *   – Enter during IME composition (CJK)             → confirm candidate, no submit
 *   – When disabled                                  → noop
 *
 * The plugin uses COMMAND_PRIORITY_HIGH so it fires before the default
 * rich-text insertion handler; returning `true` prevents the default.
 */
export function SubmitPlugin({ onSubmit, disabled, dom = domAdapter }: SubmitPluginProps): null {
  const [editor] = useLexicalComposerContext()
  const isComposingRef = useRef(false)
  const justSubmittedRef = useRef(false)

  useEffect(() => {
    function onCompositionStart() { isComposingRef.current = true }
    function onCompositionEnd() { isComposingRef.current = false }
    let trackedRoot: HTMLElement | null = null

    const unsubscribe = editor.registerRootListener((rootElement, prevRootElement) => {
      prevRootElement?.removeEventListener("compositionstart", onCompositionStart)
      prevRootElement?.removeEventListener("compositionend", onCompositionEnd)
      rootElement?.addEventListener("compositionstart", onCompositionStart)
      rootElement?.addEventListener("compositionend", onCompositionEnd)
      trackedRoot = rootElement
    })

    return () => {
      unsubscribe()
      trackedRoot?.removeEventListener("compositionstart", onCompositionStart)
      trackedRoot?.removeEventListener("compositionend", onCompositionEnd)
    }
  }, [editor])

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (disabled) return false
        if (!event) return false

        // Guard against IME composition. Three signals are checked:
        //   1. isComposingRef tracks compositionstart/compositionend on the editor
        //      root — catches the Korean IME edge case on macOS Chrome where
        //      event.isComposing may be false even though composition is active.
        //   2. event.isComposing — the standard W3C flag.
        //   3. event.keyCode === 229 — the "Process" key sent by IMEs on some
        //      browser/OS combinations even when isComposing is reported as false.
        if (isComposingRef.current || event.isComposing || event.keyCode === 229) return false

        // Shift+Enter → insert newline; do not intercept.
        if (event.shiftKey) return false

        // A typeahead picker (mention `@` / slash `/`) is open: let its own
        // lower-priority KEY_ENTER_COMMAND handler select the highlighted
        // option. This plugin runs at COMMAND_PRIORITY_HIGH, so returning
        // false here lets the event fall through to the typeahead instead of
        // submitting the raw trigger text.
        if (isTypeaheadMenuOpen(dom)) return false

        // Touch devices: allow the OS keyboard's Return key to insert newlines,
        // unless a fine pointer (mouse/trackpad) indicates a hardware keyboard
        // is connected — e.g. iPad + Magic Keyboard or Universal Control.
        if (dom.isTouchDevice() && !dom.matchesMediaQuery("(hover: hover) and (pointer: fine)")) return false

        // Guard against a double-submission caused by some macOS Korean IME
        // browser behaviour: the browser fires two keydown events for the same
        // Enter press (one to commit the composition, one as the real Enter),
        // and Lexical's async compositionend handling can re-insert the final
        // syllable into the just-cleared editor before the second keydown fires.
        // justSubmittedRef is set to true on submit and cleared after one
        // microtask — enough to block the same-sequence second keydown but not
        // subsequent legitimate Enter presses.
        if (justSubmittedRef.current) return false

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

        justSubmittedRef.current = true
        Promise.resolve().then(() => { justSubmittedRef.current = false })

        onSubmit(payload)
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, disabled, onSubmit, dom])

  return null
}
