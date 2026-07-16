import { useEffect } from "react"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"
import type { KannaSocket } from "./socket"

interface FocusSocket {
  setFocusedChat(chatId: string | null): void
}

export interface UsePushFocusPorts {
  dom?: DomPort
}

interface UsePushFocusArgs {
  socket: Pick<KannaSocket, "setFocusedChat">
  activeChatId: string | null
  ports?: UsePushFocusPorts
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

export function usePushFocus({ socket, activeChatId, ports }: UsePushFocusArgs): void {
  const dom = ports?.dom ?? domAdapter

  useEffect(() => {
    const apply = () => {
      applyPushFocus({
        socket,
        activeChatId,
        visibilityState: dom.getVisibilityState(),
      })
    }

    apply()
    const cleanupVisibility = dom.addDocumentListener("visibilitychange", apply)
    const cleanupPageHide = dom.addWindowListener("pagehide", apply)
    const cleanupPageShow = dom.addWindowListener("pageshow", apply)

    return () => {
      cleanupVisibility()
      cleanupPageHide()
      cleanupPageShow()
      socket.setFocusedChat(null)
    }
  }, [socket, activeChatId, dom])
}
