import { useCallback } from "react"
import { useKannaStateStore } from "../stores/kannaStateStore"
import type { KannaSocket } from "./socket"

export function useToggleChatPin(socket: KannaSocket) {
  return useCallback(async (chatId: string, pinned: boolean) => {
    try {
      await socket.command({ type: "chat.setPin", chatId, pinned })
      useKannaStateStore.getState().setCommandError(null)
    } catch (error) {
      useKannaStateStore.getState().setCommandError(error instanceof Error ? error.message : String(error))
    }
  }, [socket])
}
