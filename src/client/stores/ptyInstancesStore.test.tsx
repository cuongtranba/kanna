import "../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { PtyInstanceState } from "../../shared/pty-instance"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { createPtyInstancesStore, usePtyInstanceForChat, usePtyInstancesStore } from "./ptyInstancesStore"

async function renderText(element: React.ReactElement): Promise<string> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(element) })
  const text = container.textContent ?? ""
  await act(async () => { root.unmount() })
  container.remove()
  return text
}

function instance(chatId: string, overrides: Partial<PtyInstanceState> = {}): PtyInstanceState {
  return {
    chatId,
    sessionId: null,
    pid: null,
    cwd: "/tmp",
    model: "claude-opus-4-7",
    accountLabel: null,
    oauthMasked: null,
    phase: "ready",
    startedAt: 0,
    lastEventAt: 0,
    turnCount: 0,
    tokensIn: 0,
    tokensOut: 0,
    planMode: null,
    smokeTest: null,
    outputRingTail: null,
    exitedAt: null,
    exitCode: null,
    rssBytes: null,
    rssPeakBytes: null,
    cpuPercent: null,
    cpuPeakPercent: null,
    tuiStatus: null,
    ...overrides,
  }
}

describe("ptyInstancesStore", () => {
  test("applySnapshot replaces instances and keeps stable empty ref", () => {
    const store = createPtyInstancesStore()
    const first = store.getState().instances
    store.getState().applySnapshot([])
    expect(store.getState().instances).toBe(first)
    store.getState().applySnapshot([instance("c1")])
    expect(store.getState().instances).toHaveLength(1)
  })

  test("applyDiff added/updated/removed", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "added", instance: instance("c1") })
    expect(store.getState().instances).toHaveLength(1)
    store.getState().applyDiff({ op: "added", instance: instance("c1") })
    expect(store.getState().instances).toHaveLength(1)
    store.getState().applyDiff({ op: "updated", instance: instance("c1", { phase: "streaming" }) })
    expect(store.getState().instances[0]!.phase).toBe("streaming")
    store.getState().applyDiff({ op: "removed", chatId: "c1" })
    expect(store.getState().instances).toHaveLength(0)
  })

  test("applySnapshot drops exited entries", () => {
    const store = createPtyInstancesStore()
    store.getState().applySnapshot([
      instance("c1", { phase: "ready" }),
      instance("c2", { phase: "exited" }),
      instance("c3", { phase: "streaming" }),
    ])
    const ids = store.getState().instances.map((i) => i.chatId)
    expect(ids).toEqual(["c1", "c3"])
  })

  test("applyDiff added with exited phase is ignored", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "added", instance: instance("c1", { phase: "exited" }) })
    expect(store.getState().instances).toHaveLength(0)
  })

  test("applyDiff updated transitioning to exited removes entry", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "added", instance: instance("c1", { phase: "ready" }) })
    expect(store.getState().instances).toHaveLength(1)
    store.getState().applyDiff({ op: "updated", instance: instance("c1", { phase: "exited" }) })
    expect(store.getState().instances).toHaveLength(0)
  })

  test("applyDiff updated for unknown live entry inserts it", () => {
    const store = createPtyInstancesStore()
    store.getState().applyDiff({ op: "updated", instance: instance("c1", { phase: "ready" }) })
    expect(store.getState().instances).toHaveLength(1)
  })

  test("popover toggles", () => {
    const store = createPtyInstancesStore()
    store.getState().togglePopover()
    expect(store.getState().popoverOpen).toBe(true)
    store.getState().closePopover()
    expect(store.getState().popoverOpen).toBe(false)
  })
})

describe("usePtyInstanceForChat", () => {
  const status: PtyInstanceState["tuiStatus"] = {
    verb: "Whirlpooling",
    elapsedSeconds: 671,
    tokens: 40500,
    effort: "almost done thinking with xhigh effort",
    raw: "Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)",
  }

  function Probe({ chatId }: { chatId: string | undefined }) {
    const inst = usePtyInstanceForChat(chatId)
    return <span>{inst?.tuiStatus?.verb ?? "none"}</span>
  }

  test("renders the matching instance's status and null for unknown / undefined chats", async () => {
    usePtyInstancesStore.getState().applySnapshot([instance("c1", { tuiStatus: status })])
    expect(await renderText(<Probe chatId="c1" />)).toContain("Whirlpooling")
    expect(await renderText(<Probe chatId="missing" />)).toBe("none")
    expect(await renderText(<Probe chatId={undefined} />)).toBe("none")
  })

  test("does not trigger a render loop (stable ref / null)", async () => {
    usePtyInstancesStore.getState().applySnapshot([instance("c1", { tuiStatus: status })])
    function Probe() {
      const inst = usePtyInstanceForChat("c1")
      return <span>{inst?.tuiStatus?.tokens ?? 0}</span>
    }
    const result = await renderForLoopCheck(<Probe />)
    await result.cleanup()
    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
  })
})
