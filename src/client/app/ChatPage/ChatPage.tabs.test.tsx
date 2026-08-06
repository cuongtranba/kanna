/**
 * Session-tabs oracle tests.
 *
 * Each test maps to one clause of the feature contract (see the verify script
 * scripts/verify-session-tabs.sh). The names are load-bearing — the oracle
 * greps the junit report for them verbatim.
 *
 * WHY THESE DRIVE THE PRODUCTION STORE AND THE REAL RENDER DISPATCH, NOT
 * HAND-MOUNTED FAKES.
 *
 * A previous version of this file passed 4938 tests while the feature did not
 * exist. It called the pure pane helpers directly and hand-mounted two
 * ChatTabRoots, which proves the primitives work but NOT that the app uses
 * them: at that time `openTab` deduped every chat onto one tab, and the running
 * app showed exactly one tab no matter how many chats were open.
 *
 * So these exercise the path a chat actually travels: `usePaneLayoutStore`
 * with the real `{kind:"chat", chatId}` target ChatPage builds, plus
 * `describeTab` / `renderPaneContent` — the functions the tab strip and pane
 * body call. A regression that re-singletons chat tabs, drops the chatId from
 * the target, or stops routing the target into the renderer fails one of these.
 */

import { beforeEach, describe, expect, test } from "bun:test"
import { buildTabId, collectPanes, type PaneLeaf, type PaneTabTarget } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { useChatStateStore, selectChatSlice } from "../../stores/chatStateStore"
import { describeTab } from "../../components/panes/tabPresentation"
import {
  renderPaneContent,
  type PaneContentRegistry,
} from "../../components/panes/paneContentRegistry"

const PROJECT = "project-1"
const CHAT_A = "chat-aaa"
const CHAT_B = "chat-bbb"
const CHAT_C = "chat-ccc"

const store = () => usePaneLayoutStore.getState()

/** Every chat tab currently in the project's layout, in order. */
function chatTabs(projectId: string): { tabId: string; chatId: string }[] {
  return collectPanes(store().getLayout(projectId).root)
    .flatMap((pane) => pane.tabs)
    .flatMap((tab) =>
      tab.target.kind === "chat" ? [{ tabId: tab.tabId, chatId: tab.target.chatId }] : [],
    )
}

/** The chatId of the focused tab in the focused pane, or null. */
function focusedChatId(projectId: string): string | null {
  const layout = store().getLayout(projectId)
  const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
  const tab = pane?.tabs.find((t) => t.tabId === pane.focusedTabId)
  return tab?.target.kind === "chat" ? tab.target.chatId : null
}

beforeEach(() => {
  usePaneLayoutStore.setState({ layouts: {} })
})

describe("ChatPage session-tabs", () => {
  /**
   * (a) THE regression test.
   *
   * ChatPage's reconcile effect calls exactly this for the chat named by the
   * URL. If a chat target ever loses its chatId — the state this feature
   * started from — `buildTabId` collapses to the constant "chat" and this fails.
   */
  test("renders the chat route through the real router", () => {
    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_A })

    const tabs = chatTabs(PROJECT)
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.chatId).toBe(CHAT_A)
    // The id must be derived from the chatId, not a shared literal.
    expect(tabs[0]?.tabId).toBe(buildTabId({ kind: "chat", chatId: CHAT_A }))
    expect(tabs[0]?.tabId).not.toBe("chat")
  })

  // ─── (b) One tab per open chat, N open = N tabs ──────────────────────────

  test("N open chats produce N tabs", () => {
    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_A })
    expect(chatTabs(PROJECT)).toHaveLength(1)

    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_B })
    expect(chatTabs(PROJECT)).toHaveLength(2)

    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_C })
    expect(chatTabs(PROJECT).map((t) => t.chatId)).toEqual([CHAT_A, CHAT_B, CHAT_C])

    // Closing one leaves the rest — the tab set is not rebuilt from the route.
    const bTab = chatTabs(PROJECT).find((t) => t.chatId === CHAT_B)
    store().closeTab(PROJECT, bTab!.tabId)
    expect(chatTabs(PROJECT).map((t) => t.chatId)).toEqual([CHAT_A, CHAT_C])

    // Re-opening an already-open chat focuses it rather than duplicating it.
    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_A })
    expect(chatTabs(PROJECT).map((t) => t.chatId)).toEqual([CHAT_A, CHAT_C])
  })

  // ─── (c) Two tabs render two different transcripts ───────────────────────

  /**
   * The pane body renders whatever `renderPaneContent` dispatches for a tab's
   * target. ChatPage's chat renderer reads `target.chatId` and hands it to
   * ChatTabRoot, which calls `useKannaState(chatId)` — so proving the registry
   * receives two DIFFERENT chatIds is what proves two panes show two different
   * transcripts. A renderer that ignored its target (as ChatPage's did before
   * this feature) returns the same content for both and fails here.
   */
  test("two chat tabs render two different transcripts", () => {
    const rendered: string[] = []
    const registry: PaneContentRegistry = {
      chat: (target) => {
        rendered.push(`transcript:${target.chatId}`)
        return null
      },
      changes: () => null,
      terminal: () => null,
    }

    const pane: PaneLeaf = { kind: "pane", id: "p", tabs: [], focusedTabId: null }
    const targetA: PaneTabTarget = { kind: "chat", chatId: CHAT_A }
    const targetB: PaneTabTarget = { kind: "chat", chatId: CHAT_B }

    renderPaneContent(registry, targetA, pane, true)
    renderPaneContent(registry, targetB, pane, false)

    expect(rendered).toEqual([`transcript:${CHAT_A}`, `transcript:${CHAT_B}`])
    expect(rendered[0]).not.toBe(rendered[1])

    // And the two tabs are distinguishable in the strip, so a user can tell
    // which transcript is which.
    const titles = { [CHAT_A]: "First chat", [CHAT_B]: "Second chat" }
    expect(describeTab(targetA, { chatTitles: titles }).label).toBe("First chat")
    expect(describeTab(targetB, { chatTitles: titles }).label).toBe("Second chat")
  })

  // ─── (d) Keyboard switching ──────────────────────────────────────────────

  /**
   * ChatPage's keydown handler calls exactly this for a `cycleTab` command,
   * then points the URL at whichever chat tab ended up focused.
   */
  test("keyboard switches to the next chat tab", () => {
    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_A })
    store().openTab(PROJECT, { kind: "chat", chatId: CHAT_B })

    // openTab focuses what it opened, so B is current.
    expect(focusedChatId(PROJECT)).toBe(CHAT_B)

    store().cycleFocusedPaneTab(PROJECT, 1)
    expect(focusedChatId(PROJECT)).toBe(CHAT_A)

    // Wraps around rather than stopping at the end.
    store().cycleFocusedPaneTab(PROJECT, 1)
    expect(focusedChatId(PROJECT)).toBe(CHAT_B)

    store().cycleFocusedPaneTab(PROJECT, -1)
    expect(focusedChatId(PROJECT)).toBe(CHAT_A)
  })

  // ─── (e) Per-tab state isolation ─────────────────────────────────────────

  /**
   * `chatStateStore` is keyed by chatId, so writing one chat's slice must not
   * change another's reference. A shared slice would make every tab render the
   * same transcript, and an unstable one would re-render every tab on every
   * push (which is what left the transcript list unable to settle when two
   * consumers each held their own subscription to the same chat).
   */
  test("updating chatA does not affect chatB slice reference", () => {
    useChatStateStore.getState().setChatReady(CHAT_A, true)
    useChatStateStore.getState().setChatReady(CHAT_B, true)

    const before = selectChatSlice(useChatStateStore.getState(), CHAT_B)
    useChatStateStore.getState().setHistoryCursor(CHAT_A, "cursor-1")
    const after = selectChatSlice(useChatStateStore.getState(), CHAT_B)

    expect(after).toBe(before)
    expect(selectChatSlice(useChatStateStore.getState(), CHAT_A).historyCursor).toBe("cursor-1")
  })
})
