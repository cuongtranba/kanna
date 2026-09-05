
import { describe, expect, test } from "bun:test"
import { MemoryRouter } from "react-router-dom"
import { AppDialogProvider } from "../components/ui/app-dialog"
import { AppGlobalProvider, useAppGlobalContext } from "./AppGlobalProvider"
import type { KannaSocket, SocketStatus } from "./socket"
import type { SubscriptionTopic } from "../../shared/protocol"
import { makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"


function makeRecordingSocket() {
  const topicsSubscribed: string[] = []

  const socket = {
    start(): void { },
    dispose(): void { },
    subscribe(topic: SubscriptionTopic, _listener: unknown): () => void {
      topicsSubscribed.push(topic.type)
      return () => { }
    },
    onStatus(_listener: (s: SocketStatus) => void): () => void {
      return () => { }
    },
    command(_command: unknown): Promise<unknown> {
      return Promise.resolve({})
    },
  } as unknown as KannaSocket

  return { socket, topicsSubscribed }
}


const GLOBAL_TOPICS = [
  "sidebar",
  "local-projects",
  "update",
  "keybindings",
  "app-settings",
  "push-config",
  "pty-instances",
  "followed-sessions",
] as const

describe("AppGlobalProvider", () => {
  test("global topics subscribed exactly once even with two consumers", async () => {
    const { socket, topicsSubscribed } = makeRecordingSocket()

    function Consumer() {
      useAppGlobalContext()
      return null
    }

    const result = await renderForLoopCheck(
      <MemoryRouter>
        <AppDialogProvider ports={{ timer: makeFakeTimerPort() }}>
          <AppGlobalProvider ports={{ socket }}>
            <Consumer />
            <Consumer />
          </AppGlobalProvider>
        </AppDialogProvider>
      </MemoryRouter>,
    )

    expect(result.thrown).toBeNull()
    expect(result.loopWarnings).toEqual([])

    for (const topic of GLOBAL_TOPICS) {
      const count = topicsSubscribed.filter((t) => t === topic).length
      expect(
        count,
        `topic "${topic}" subscribed ${String(count)} time(s) — expected exactly 1`,
      ).toBe(1)
    }

    await result.cleanup()
  })
})
