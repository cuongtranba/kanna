/**
 * AppGlobalProvider — subscription-dedup guarantee.
 *
 * Architecture promise: N mounted `useKannaState` consumers → 1 global
 * subscription set. This test pins that invariant by rendering two consumers
 * under a single provider and asserting each global topic is subscribed ONCE.
 */

import { describe, expect, test } from "bun:test"
import { MemoryRouter } from "react-router-dom"
import { AppDialogProvider } from "../components/ui/app-dialog"
import { AppGlobalProvider, useAppGlobalContext } from "./AppGlobalProvider"
import type { KannaSocket, SocketStatus } from "./socket"
import type { SubscriptionTopic } from "../../shared/protocol"
import { makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"

// ─── Fake socket ─────────────────────────────────────────────────────────────

/**
 * A minimal recording fake typed against the public methods `AppGlobalProvider`
 * calls. Tracks every `subscribe` invocation so the test can assert that the
 * global subscription set is not duplicated across consumers.
 *
 * `KannaSocket` is a class with private fields so a structural object literal
 * cannot satisfy its type without a cast — following the precedent established
 * in `KannaSocketProvider.test.tsx`.
 */
function makeRecordingSocket() {
  const topicsSubscribed: string[] = []

  const socket = {
    start(): void { /* no-op — don't connect */ },
    dispose(): void { /* no-op */ },
    subscribe(topic: SubscriptionTopic, _listener: unknown): () => void {
      topicsSubscribed.push(topic.type)
      return () => { /* no-op */ }
    },
    onStatus(_listener: (s: SocketStatus) => void): () => void {
      return () => { /* no-op */ }
    },
    command(_command: unknown): Promise<unknown> {
      return Promise.resolve({})
    },
  } as unknown as KannaSocket

  return { socket, topicsSubscribed }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

/** The 8 global topics that `useAppGlobalState` subscribes to. */
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

    // Two components that each read from the shared app-global context.
    function Consumer() {
      useAppGlobalContext()
      return null
    }

    const result = await renderForLoopCheck(
      <MemoryRouter>
        {/* AppDialogProvider satisfies useAppDialog inside useAppGlobalState */}
        <AppDialogProvider ports={{ timer: makeFakeTimerPort() }}>
          {/* Provider owns the single call to useAppGlobalState */}
          <AppGlobalProvider ports={{ socket }}>
            <Consumer />
            <Consumer />
          </AppGlobalProvider>
        </AppDialogProvider>
      </MemoryRouter>,
    )

    expect(result.thrown).toBeNull()
    expect(result.loopWarnings).toEqual([])

    // Core invariant: every global topic subscribed exactly once, regardless
    // of how many consumers call useAppGlobalContext().
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
