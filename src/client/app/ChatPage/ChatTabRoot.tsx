import { createContext, use, type ReactNode } from "react"
import type { DomPort } from "../../ports/domPort"
import type { TimerPort } from "../../ports/timerPort"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"
import { useKannaState, type KannaState } from "../useKannaState"

/**
 * The KannaState belonging to ONE chat tab.
 *
 * Separate from the route's outlet context on purpose. The outlet carries the
 * state for the chat in the URL and is what Settings / Workflows / LocalProjects
 * read; a chat tab must instead read the state for the chat IT addresses, which
 * is the same chat only for the focused tab.
 */
const ChatTabStateContext = createContext<KannaState | null>(null)

/**
 * Read the KannaState of the enclosing chat tab.
 *
 * Throws rather than falling back to the outlet context: a silent fallback would
 * make every unwrapped tab render the focused chat's transcript, so two tabs
 * would show identical content and the bug would read as a rendering quirk
 * instead of a missing Provider.
 */
export function useChatTabState(): KannaState {
  const state = use(ChatTabStateContext)
  if (!state) {
    throw new Error("useChatTabState must be used inside a ChatTabRoot")
  }
  return state
}

export interface ChatTabRootProps {
  /** The chat this tab addresses. Null only on the no-project fallback path. */
  chatId: string | null
  timer?: TimerPort
  dom?: DomPort
  children: ReactNode
}

/**
 * Mounts the two per-tab providers for one chat tab.
 *
 * 1. `useKannaState(chatId)` — this tab's own live transcript, subscriptions and
 *    handlers. Calling it once PER TAB is what lets two tabs show two different
 *    live chats; the app-global half (socket, sidebar, settings) is owned by
 *    AppGlobalProvider, so N tabs still share one socket.
 * 2. `ChatTabScopedStore` — this tab's composer text, scroll position and input
 *    height, so typing in one tab never appears in another.
 *
 * The Provider and its consumers are deliberately separate components: a
 * component cannot consume a context it provides itself, and putting a consumer
 * above this boundary is what previously blanked the page.
 */
export function ChatTabRoot({ chatId, timer, dom, children }: ChatTabRootProps) {
  const state = useKannaState(chatId, { timer, dom })

  return (
    <ChatTabStateContext.Provider value={state}>
      <ChatTabScopedStore.Provider init={undefined}>{children}</ChatTabScopedStore.Provider>
    </ChatTabStateContext.Provider>
  )
}
