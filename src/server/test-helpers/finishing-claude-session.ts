import { timestamped } from "../../shared/transcript-entry"
import type { ClaudeSessionHandle, HarnessEvent } from "../harness-types"
import { AsyncEventQueue } from "./async-event-queue"

export function finishingClaudeSession(): () => Promise<ClaudeSessionHandle> {
  return async () => {
    const events = new AsyncEventQueue<HarnessEvent>()
    return {
      provider: "claude",
      stream: events,
      interrupt: async () => {},
      close: () => events.close(),
      closed: Promise.resolve(),
      sendPrompt: async () => {
        events.push({
          type: "transcript",
          entry: timestamped({ kind: "result", subtype: "success", isError: false, durationMs: 1, result: "" }),
        })
        events.close()
      },
      setModel: async () => {},
      setPermissionMode: async () => {},
    }
  }
}
