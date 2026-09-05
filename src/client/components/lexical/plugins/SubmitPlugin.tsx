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


export type SubmitPayload = WirePayload

export interface SubmitPluginProps {
  onSubmit: (payload: SubmitPayload) => void
  disabled: boolean
  dom?: DomPort
}


export function isTypeaheadMenuOpen(dom: Pick<DomPort, "hasTypeaheadMenuOpen"> = domAdapter): boolean {
  return dom.hasTypeaheadMenuOpen()
}


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

        if (isComposingRef.current || event.isComposing || event.keyCode === 229) return false

        if (event.shiftKey) return false

        if (isTypeaheadMenuOpen(dom)) return false

        if (dom.isTouchDevice() && !dom.matchesMediaQuery("(hover: hover) and (pointer: fine)")) return false

        if (justSubmittedRef.current) return false

        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false

        event.preventDefault()

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
