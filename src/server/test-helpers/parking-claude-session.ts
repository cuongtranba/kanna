import type { AgentCoordinatorArgs } from "../agent-coordinator-types"
import type { ClaudeSessionHandle } from "../harness-types"

export const PARKED_QUESTION_ID = "question-1"

export const PARKED_QUESTIONS = [
  { id: "provider", question: "Which provider?", options: [{ label: "claude" }, { label: "codex" }] },
]

export interface ParkingClaudeSession {
  start: NonNullable<AgentCoordinatorArgs["startClaudeSession"]>
  crash: () => void
}

export function parkingClaudeSession(): ParkingClaudeSession {
  let release: (error: Error | null) => void = () => {}
  const start: ParkingClaudeSession["start"] = async (args) => {
    let promptSent: () => void = () => {}
    const sent = new Promise<void>((resolve) => {
      promptSent = resolve
    })
    const ended = new Promise<Error | null>((resolve) => {
      release = resolve
    })
    const handle: ClaudeSessionHandle = {
      provider: "claude",
      stream: {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            await sent
            const error = await ended
            if (error) throw error
            return { done: true, value: undefined }
          },
        }),
      },
      interrupt: async () => {
        release(null)
      },
      close: () => {
        promptSent()
        release(null)
      },
      closed: Promise.resolve(),
      sendPrompt: async () => {
        promptSent()
        void args.onToolRequest({
          tool: {
            kind: "tool",
            toolKind: "ask_user_question",
            toolName: "AskUserQuestion",
            toolId: PARKED_QUESTION_ID,
            input: { questions: PARKED_QUESTIONS },
          },
        })
      },
      setModel: async () => {},
      setPermissionMode: async () => {},
    }
    return handle
  }
  return { start, crash: () => release(new Error("session crashed")) }
}
