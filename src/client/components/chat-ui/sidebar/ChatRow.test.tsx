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
