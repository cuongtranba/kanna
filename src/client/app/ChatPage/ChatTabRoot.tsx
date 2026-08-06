import type { ReactNode } from "react"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"

/**
 * Mounts ChatTabScopedStore.Provider for one chat tab.
 *
 * Every chat entry in the pane registry wraps its content in this component
 * so that tab-scoped state (composer text, attachments, scroll position, …)
 * is independent per tab and does not bleed between tabs.
 *
 * Keeping the Provider and its consumers in separate components is the
 * standard React pattern — a component cannot consume a context it provides
 * itself. ChatTabContent (the consumer) renders as a child here.
 */
export function ChatTabRoot({ children }: { children: ReactNode }) {
  return (
    <ChatTabScopedStore.Provider init={undefined}>
      {children}
    </ChatTabScopedStore.Provider>
  )
}
