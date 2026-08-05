/**
 * ChatNavigatorPort — intent-named navigation for the chat app.
 *
 * Three semantic operations that happen to be React Router navigate() calls:
 *
 *   openChat  — "I just created or selected a chat, show it"
 *   closeChat — "The chat I was viewing no longer exists, go back"
 *   goHome    — "There is no project/chat to compose in, show the home screen"
 *
 * The concrete adapter is built in AppGlobalProvider via makeChatNavigator()
 * and distributed through AppGlobalState so both useAppGlobalState and
 * useKannaState share one navigator (one useNavigate() call at the provider
 * boundary).
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export interface ChatNavigatorPort {
  /** Navigate to a specific chat. Used after creating or selecting a chat. */
  openChat(chatId: string): void
  /** Navigate away from the current chat (it is gone or archived). */
  closeChat(): void
  /** Navigate to the home screen when there is no context to compose in. */
  goHome(): void
}

/**
 * Creates a ChatNavigatorPort backed by a React Router navigate function.
 *
 * Call this inside a component mounted within a Router boundary. The returned
 * object is a stable plain object (no hooks), safe to pass as a prop or
 * context value.
 */
export function makeChatNavigator(navigate: (path: string) => void): ChatNavigatorPort {
  return {
    openChat: (chatId) => navigate(`/chat/${chatId}`),
    closeChat: () => navigate("/"),
    goHome: () => navigate("/"),
  }
}
