
import { create } from "zustand"
import { ReadyState } from "react-use-websocket"

export type SendMessageFn = (message: string) => void

interface SocketState {
  readyState: ReadyState
  sendMessage: SendMessageFn | null
  setReadyState: (state: ReadyState) => void
  setSendMessage: (fn: SendMessageFn) => void
}

const INITIAL_READY_STATE = ReadyState.UNINSTANTIATED

export const useSocketStore = create<SocketState>()((set) => ({
  readyState: INITIAL_READY_STATE,
  sendMessage: null,
  setReadyState: (state) => set({ readyState: state }),
  setSendMessage: (fn) => set({ sendMessage: fn }),
}))
