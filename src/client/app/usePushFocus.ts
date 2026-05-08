import { useEffect } from "react"
import type { KannaSocket } from "./socket"

interface FocusSocket {
  setFocusedChat(chatId: string | null): void
}

interface UsePushFocusArgs {
  socket: Pick<KannaSocket, "setFocusedChat">
  activeChatId: string | null
}

export function resolveFocusedChatId(args: {
  activeChatId: string | null
  visibilityState: DocumentVisibilityState
}): string | null {
  return args.visibilityState === "visible" ? args.activeChatId : null
}

export function applyPushFocus(args: {
  socket: FocusSocket
  activeChatId: string | null
  visibilityState: DocumentVisibilityState
}): void {
  args.socket.setFocusedChat(
    resolveFocusedChatId({
      activeChatId: args.activeChatId,
      visibilityState: args.visibilityState,
    }),
  )
}

export function usePushFocus({ socket, activeChatId }: UsePushFocusArgs): void {
  useEffect(() => {
    if (typeof document === "undefined") return

    const apply = () => {
      applyPushFocus({
        socket,
        activeChatId,
        visibilityState: document.visibilityState,
      })
    }

    apply()
    document.addEventListener("visibilitychange", apply)
    window.addEventListener("pagehide", apply)
    window.addEventListener("pageshow", apply)

    return () => {
      document.removeEventListener("visibilitychange", apply)
      window.removeEventListener("pagehide", apply)
      window.removeEventListener("pageshow", apply)
      socket.setFocusedChat(null)
    }
  }, [socket, activeChatId])
}
