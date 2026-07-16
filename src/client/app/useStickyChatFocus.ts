import { useEffect, type RefObject } from "react"
import {
  hasActiveTextSelection,
  RESTORE_CHAT_INPUT_FOCUS_EVENT,
  resolveChatFocusAction,
} from "./chatFocusPolicy"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"

interface StickyChatFocusPorts {
  dom: DomPort
  timer: TimerPort
}

interface StickyChatFocusOptions {
  rootRef: RefObject<HTMLElement | null>
  fallbackRef: RefObject<HTMLTextAreaElement | null>
  enabled: boolean
  canCancel: boolean
  ports?: StickyChatFocusPorts
}

const DEFAULT_PORTS: StickyChatFocusPorts = {
  dom: domAdapter,
  timer: timerAdapter,
}

export function useStickyChatFocus({ rootRef, fallbackRef, enabled, canCancel, ports = DEFAULT_PORTS }: StickyChatFocusOptions) {
  const { dom, timer } = ports

  useEffect(() => {
    if (!enabled) return

    let rafId = 0
    let pointerStartTarget: Element | null = null

    const restoreFocusIfNeeded = (pointerEndTarget: EventTarget | null) => {
      const target = pointerEndTarget instanceof Element ? pointerEndTarget : null
      const root = rootRef.current
      const fallback = fallbackRef.current

      if (resolveChatFocusAction({
        trigger: "pointer",
        activeElement: dom.getActiveElement(),
        pointerStartTarget,
        pointerEndTarget: target,
        root,
        fallback,
        hasActiveOverlay: dom.hasFocusOverlay(),
        hasActiveSelection: hasActiveTextSelection(dom.getSelection()),
      }) !== "restore") {
        pointerStartTarget = null
        return
      }

      fallback?.focus({ preventScroll: true })
      pointerStartTarget = null
    }

    const handlePointerDown = (event: PointerEvent) => {
      timer.cancelAnimationFrame(rafId)
      pointerStartTarget = event.target instanceof Element ? event.target : null
    }

    const handlePointerUp = (event: PointerEvent) => {
      timer.cancelAnimationFrame(rafId)
      rafId = timer.requestAnimationFrame(() => {
        restoreFocusIfNeeded(event.target)
      })
    }

    const handleRestoreFocus = () => {
      pointerStartTarget = null
      const fallback = fallbackRef.current
      if (!fallback || fallback.disabled) return
      fallback.focus({ preventScroll: true })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return

      const fallback = fallbackRef.current
      if (resolveChatFocusAction({
        trigger: "escape",
        activeElement: dom.getActiveElement(),
        fallback,
        hasActiveOverlay: dom.hasFocusOverlay(),
        canCancel,
        defaultPrevented: event.defaultPrevented,
      }) !== "escape-focus") {
        return
      }

      event.preventDefault()
      fallback?.focus({ preventScroll: true })
    }

    const cleanupPointerDown = dom.addWindowCaptureListener("pointerdown", handlePointerDown)
    const cleanupPointerUp = dom.addWindowCaptureListener("pointerup", handlePointerUp)
    const cleanupKeyDown = dom.addWindowCaptureListener("keydown", handleKeyDown)
    const cleanupRestoreFocus = dom.addWindowCustomListener(RESTORE_CHAT_INPUT_FOCUS_EVENT, handleRestoreFocus)

    return () => {
      timer.cancelAnimationFrame(rafId)
      cleanupPointerDown()
      cleanupPointerUp()
      cleanupKeyDown()
      cleanupRestoreFocus()
    }
  }, [canCancel, dom, enabled, fallbackRef, rootRef, timer])
}
