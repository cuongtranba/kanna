import { createContext, use, type ReactNode } from "react"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"
import { useKannaState, type KannaState } from "../useKannaState"

const ChatTabStateContext = createContext<KannaState | null>(null)

export function useChatTabState(): KannaState {
  const state = use(ChatTabStateContext)
  if (!state) {
    throw new Error("useChatTabState must be used inside a ChatTabRoot")
  }
  return state
}

export interface ChatTabRootProps {
  chatId: string | null
  timer?: TimerPort
  dom?: DomPort
  children: ReactNode
}

export function ChatTabRoot({ chatId, timer, dom, children }: ChatTabRootProps) {
  const state = useKannaState(chatId, { timer, dom })

  return (
    <ChatTabStateContext.Provider value={state}>
      <ChatTabScopedStore.Provider init={undefined}>{children}</ChatTabScopedStore.Provider>
    </ChatTabStateContext.Provider>
  )
}
