import { useEffect, type RefObject } from "react"
import type { ChatInputHandle } from "../../components/chat-ui/ChatInput"
import type { TimerPort } from "../../ports/timerPort"
import { useComposerFocusStore } from "../../stores/composerFocusStore"

export function useComposerFocusRequest(args: {
  chatId: string | null
  isFocused: boolean
  chatInputRef: RefObject<ChatInputHandle | null>
  timer: TimerPort
}) {
  const { chatId, isFocused, chatInputRef, timer } = args
  const request = useComposerFocusStore((state) => state.request)
  const consumeComposerFocus = useComposerFocusStore((state) => state.consumeComposerFocus)

  useEffect(() => {
    if (!request || !isFocused || request.chatId !== chatId) return
    const frame = timer.requestAnimationFrame(() => {
      consumeComposerFocus(request.nonce)
      chatInputRef.current?.focus()
    })
    return () => timer.cancelAnimationFrame(frame)
  }, [chatId, chatInputRef, consumeComposerFocus, isFocused, request, timer])
}
