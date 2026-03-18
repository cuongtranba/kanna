import { useEffect, type RefObject } from "react"
import { hasActiveFocusOverlay, RESTORE_CHAT_INPUT_FOCUS_EVENT, shouldRestoreChatInputFocus } from "./chatFocusPolicy"

interface StickyChatFocusOptions {
  rootRef: RefObject<HTMLElement | null>
  fallbackRef: RefObject<HTMLTextAreaElement | null>
  enabled: boolean
}

export function useStickyChatFocus({ rootRef, fallbackRef, enabled }: StickyChatFocusOptions) {
  useEffect(() => {
    if (!enabled) return

    let rafId = 0

    const restoreFocusIfNeeded = (pointerTarget: EventTarget | null) => {
      const target = pointerTarget instanceof Element ? pointerTarget : null
      const root = rootRef.current
      const fallback = fallbackRef.current

      if (!shouldRestoreChatInputFocus({
        activeElement: document.activeElement,
        pointerTarget: target,
        root,
        fallback,
        hasActiveOverlay: hasActiveFocusOverlay(document),
      })) {
        return
      }

      fallback?.focus({ preventScroll: true })
    }

    const handlePointerDown = (event: PointerEvent) => {
      cancelAnimationFrame(rafId)
      const pointerTarget = event.target
      rafId = window.requestAnimationFrame(() => {
        restoreFocusIfNeeded(pointerTarget)
      })
    }

    const handleRestoreFocus = () => {
      const fallback = fallbackRef.current
      if (!fallback || fallback.disabled) return
      fallback.focus({ preventScroll: true })
    }

    window.addEventListener("pointerdown", handlePointerDown, true)
    window.addEventListener(RESTORE_CHAT_INPUT_FOCUS_EVENT, handleRestoreFocus)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener("pointerdown", handlePointerDown, true)
      window.removeEventListener(RESTORE_CHAT_INPUT_FOCUS_EVENT, handleRestoreFocus)
    }
  }, [enabled, fallbackRef, rootRef])
}
