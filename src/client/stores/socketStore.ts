/**
 * socketStore.ts — Zustand store for WebSocket connection state.
 *
 * Holds the raw transport state exposed by react-use-websocket's SocketBridge:
 *   - readyState  : current WebSocket connection state (ReadyState enum from react-use-websocket)
 *   - sendMessage : stable send function written by SocketBridge; actions call this to
 *                   dispatch outbound frames through Kanna's protocol layer.
 *
 * This store is written EXCLUSIVELY by src/client/app/SocketBridge.tsx.
 * Consumers (actions, components) read readyState and call sendMessage — they do NOT
 * construct WebSocket objects or call useWebSocket directly.
 *
 * Non-goals: correlation/subscription/queue/heartbeat logic — that lives in socket-protocol.ts.
 *
 * Architecture: see .c3/adr/adr-20260715-client-state-effect-architecture.md
 * Component: c3-101 (socket-client) / c3-102 (state-stores)
 */

import { create } from "zustand"
import { ReadyState } from "react-use-websocket"

/** Outbound message sender provided by react-use-websocket. */
export type SendMessageFn = (message: string) => void

interface SocketState {
  /** Current WebSocket readyState (mirrors ReadyState enum from react-use-websocket). */
  readyState: ReadyState
  /** Stable send function wired from SocketBridge. null until SocketBridge mounts. */
  sendMessage: SendMessageFn | null
  /** Set by SocketBridge on mount and on readyState changes. */
  setReadyState: (state: ReadyState) => void
  /** Set by SocketBridge on mount, providing the stable send function. */
  setSendMessage: (fn: SendMessageFn) => void
}

const INITIAL_READY_STATE = ReadyState.UNINSTANTIATED

export const useSocketStore = create<SocketState>()((set) => ({
  readyState: INITIAL_READY_STATE,
  sendMessage: null,
  setReadyState: (state) => set({ readyState: state }),
  setSendMessage: (fn) => set({ sendMessage: fn }),
}))
