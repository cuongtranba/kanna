import type { ReactNode } from "react"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"

/**
 * Per-chat-tab boundary.
 *
 * Mounts one independent ChatTabScopedStore instance so every chat tab has
 * its own ephemeral UI state (composer text, attachment list, scroll-to-bottom
 * flag, tool-group expansion, …). Two tabs rendered side-by-side therefore
 * never share these fields — they each read from their own Provider.
 *
 * Usage: wrap each tab's content in <ChatTabRoot> inside PaneShell.
 */
export function ChatTabRoot({ children }: { children: ReactNode }) {
  return (
    <ChatTabScopedStore.Provider init={undefined}>
      {children}
    </ChatTabScopedStore.Provider>
  )
}
