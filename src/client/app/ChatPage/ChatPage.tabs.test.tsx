
import { beforeEach, describe, expect, test } from "bun:test"
import { buildTabId, collectPanes, createDefaultLayout, type PaneLeaf, type PaneTabTarget } from "../../lib/paneTree"
import { usePaneLayoutStore } from "../../stores/paneLayoutStore"
import { useChatStateStore, selectChatSlice } from "../../stores/chatStateStore"
import { describeTab } from "../../components/panes/tabPresentation"
import {
  renderPaneContent,
  type PaneContentRegistry,
} from "../../components/panes/paneContentRegistry"

const CHAT_A = "chat-aaa"
const CHAT_B = "chat-bbb"
const CHAT_C = "chat-ccc"

const store = () => usePaneLayoutStore.getState()

function chatTabs(): { tabId: string; chatId: string }[] {
  return collectPanes(store().getLayout().root)
    .flatMap((pane) => pane.tabs)
    .flatMap((tab) =>
      tab.target.kind === "chat" ? [{ tabId: tab.tabId, chatId: tab.target.chatId }] : [],
    )
}

function focusedChatId(): string | null {
  const layout = store().getLayout()
  const pane = collectPanes(layout.root).find((p) => p.id === layout.focusedPaneId)
  const tab = pane?.tabs.find((t) => t.tabId === pane.focusedTabId)
  return tab?.target.kind === "chat" ? tab.target.chatId : null
}

beforeEach(() => {
  usePaneLayoutStore.setState({ layout: createDefaultLayout() })
})

describe("ChatPage session-tabs", () => {
  test("renders the chat route through the real router", () => {
    store().openTab({ kind: "chat", chatId: CHAT_A })

    const tabs = chatTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0]?.chatId).toBe(CHAT_A)
    expect(tabs[0]?.tabId).toBe(buildTabId({ kind: "chat", chatId: CHAT_A }))
    expect(tabs[0]?.tabId).not.toBe("chat")
  })


  test("N open chats produce N tabs", () => {
    store().openTab({ kind: "chat", chatId: CHAT_A })
    expect(chatTabs()).toHaveLength(1)

    store().openTab({ kind: "chat", chatId: CHAT_B })
    expect(chatTabs()).toHaveLength(2)

    store().openTab({ kind: "chat", chatId: CHAT_C })
    expect(chatTabs().map((t) => t.chatId)).toEqual([CHAT_A, CHAT_B, CHAT_C])

    const bTab = chatTabs().find((t) => t.chatId === CHAT_B)
    store().closeTab(bTab!.tabId)
    expect(chatTabs().map((t) => t.chatId)).toEqual([CHAT_A, CHAT_C])

    store().openTab({ kind: "chat", chatId: CHAT_A })
    expect(chatTabs().map((t) => t.chatId)).toEqual([CHAT_A, CHAT_C])
  })


  test("two chat tabs render two different transcripts", () => {
    const rendered: string[] = []
    const registry: PaneContentRegistry = {
      chat: (target) => {
        rendered.push(`transcript:${target.chatId}`)
        return null
      },
      board: () => null,
      changes: () => null,
      terminal: () => null,
    }

    const pane: PaneLeaf = { kind: "pane", id: "p", tabs: [], focusedTabId: null }
    const targetA: PaneTabTarget = { kind: "chat", chatId: CHAT_A }
    const targetB: PaneTabTarget = { kind: "chat", chatId: CHAT_B }

    renderPaneContent(registry, targetA, pane, true, true)
    renderPaneContent(registry, targetB, pane, false, true)

    expect(rendered).toEqual([`transcript:${CHAT_A}`, `transcript:${CHAT_B}`])
    expect(rendered[0]).not.toBe(rendered[1])

    const titles = { [CHAT_A]: "First chat", [CHAT_B]: "Second chat" }
    expect(describeTab(targetA, { chatTitles: titles }).label).toBe("First chat")
    expect(describeTab(targetB, { chatTitles: titles }).label).toBe("Second chat")
  })


  test("keyboard switches to the next chat tab", () => {
    store().openTab({ kind: "chat", chatId: CHAT_A })
    store().openTab({ kind: "chat", chatId: CHAT_B })

    expect(focusedChatId()).toBe(CHAT_B)

    store().cycleFocusedPaneTab(1)
    expect(focusedChatId()).toBe(CHAT_A)

    store().cycleFocusedPaneTab(1)
    expect(focusedChatId()).toBe(CHAT_B)

    store().cycleFocusedPaneTab(-1)
    expect(focusedChatId()).toBe(CHAT_A)
  })


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
