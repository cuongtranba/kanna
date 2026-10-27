import type { ClaudeSessionHandle } from "../harness-types"

export function failingClaudeSession(message = "simulated rate limit"): () => Promise<ClaudeSessionHandle> {
  return async () => {
    let promptSent: () => void = () => {}
    const sent = new Promise<void>((resolve) => {
      promptSent = resolve
    })
    return {
      provider: "claude",
      stream: {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await sent
            throw new Error(message)
          },
        }),
      },
      interrupt: async () => {},
      close: () => promptSent(),
      closed: Promise.resolve(),
      sendPrompt: async () => {
        promptSent()
      },
      setModel: async () => {},
      setPermissionMode: async () => {},
    }
  }
}
