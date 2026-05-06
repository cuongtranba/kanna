import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ChatRow } from "./ChatRow"

const baseChat = {
  _id: "chat-row-1",
  _creationTime: 1,
  chatId: "chat-1",
  title: "Test chat",
  status: "idle" as const,
  unread: false,
  localPath: "/tmp/project",
  provider: "codex" as const,
  lastMessageAt: 0,
  hasAutomation: false,
}

describe("ChatRow", () => {
  test("renders the relative age label by default", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={baseChat}
        activeChatId={null}
        nowMs={60_000}
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )

    expect(html).toContain(">1m<")
  })

  test("falls back to the chat creation time for the age label", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={{ ...baseChat, _creationTime: 30_000, lastMessageAt: undefined }}
        activeChatId={null}
        nowMs={60_000}
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )

    expect(html).toContain(">30s<")
  })

  test("prefers lastMessageAt over creation time for the age label", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={{ ...baseChat, _creationTime: 59_000, lastMessageAt: 0 }}
        activeChatId={null}
        nowMs={60_000}
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )

    expect(html).toContain(">1m<")
    expect(html).not.toContain(">1s<")
  })

  test("renders the shortcut hint when the modifier is held", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={baseChat}
        activeChatId={null}
        nowMs={60_000}
        shortcutHint="1"
        showShortcutHint
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )

    expect(html).toContain(">1<")
    expect(html).toContain("<kbd")
    expect(html).not.toContain(">1m<")
  })

  test("live running state shows full word label with elapsed time", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={{ ...baseChat, status: "running", stateEnteredAt: 0 }}
        activeChatId={null}
        nowMs={12_000}
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )
    // Full word "Running" not abbreviated "run"
    expect(html).toContain("Running")
    // Elapsed time in M:SS format
    expect(html).toContain("0:12")
    // Slot must be widened for live state
    expect(html).toContain("w-20")
  })

  test("live waiting_for_user state shows Waiting label", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={{ ...baseChat, status: "waiting_for_user", stateEnteredAt: 0 }}
        activeChatId={null}
        nowMs={30_000}
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )
    expect(html).toContain("Waiting")
    expect(html).toContain("0:30")
  })

  test("renders a fork action next to the archive action when the chat can fork", () => {
    const html = renderToStaticMarkup(
      <ChatRow
        chat={{ ...baseChat, canFork: true }}
        activeChatId={null}
        nowMs={60_000}
        onSelectChat={() => undefined}
        onRenameChat={() => undefined}
        onShareChat={() => undefined}
        onOpenInFinder={() => undefined}
        onForkChat={() => undefined}
        onArchiveChat={() => undefined}
        onDeleteChat={() => undefined}
      />
    )

    expect(html).toContain("Fork chat")
    expect(html).toContain("Archive chat")
  })
})
