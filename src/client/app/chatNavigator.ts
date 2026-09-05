
export interface ChatNavigatorPort {
  openChat(chatId: string): void
  closeChat(): void
  goHome(): void
}

export function makeChatNavigator(navigate: (path: string) => void): ChatNavigatorPort {
  return {
    openChat: (chatId) => navigate(`/chat/${chatId}`),
    closeChat: () => navigate("/"),
    goHome: () => navigate("/"),
  }
}
