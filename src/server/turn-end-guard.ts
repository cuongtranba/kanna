export interface TurnEndGuard {
  check: (chatId: string, assistantText: readonly string[]) => Promise<void>
}

export function composeTurnEndGuards(...guards: readonly TurnEndGuard[]): TurnEndGuard {
  return {
    check: async (chatId, assistantText) => {
      for (const guard of guards) await guard.check(chatId, assistantText)
    },
  }
}
