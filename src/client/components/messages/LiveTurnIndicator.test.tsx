import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { useLiveBlockStore } from "../../stores/liveBlockStore"
import { LiveTurnIndicator } from "./LiveTurnIndicator"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  useLiveBlockStore.setState({ byChat: {} })
})

async function render(chatId: string | null = "chat-1") {
  const rendered = await renderClientMarkup(<LiveTurnIndicator chatId={chatId} status="running" />)
  cleanups.push(rendered.cleanup)
  return rendered.container
}

describe("LiveTurnIndicator", () => {
  test("falls back to the generic running indicator when nothing is streaming", async () => {
    const container = await render()
    expect(container.textContent).toContain("Running...")
  })

  test("shows streamed assistant text as markdown", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: "Here is **bold** text" })
    const container = await render()
    expect(container.textContent).toContain("Here is bold text")
    expect(container.querySelector("strong")?.textContent).toBe("bold")
    expect(container.textContent).not.toContain("Running...")
  })

  test("labels streamed thinking and shows its text", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "thinking", text: "weighing options" })
    const container = await render()
    expect(container.textContent).toContain("Thinking…")
    expect(container.textContent).toContain("weighing options")
  })

  test("shows the tool name, target and input size for a streaming tool call", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", {
      kind: "tool_use",
      toolName: "Write",
      inputChars: 12_595,
      subject: "/src/app.ts",
    })
    const container = await render()
    expect(container.textContent).toContain("Write")
    expect(container.textContent).toContain("/src/app.ts")
    expect(container.querySelector("[data-testid='live-block-size']")?.textContent).toBe("12.3 KB")
  })

  test("only shows the block of its own chat", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-2", { kind: "text", text: "other chat" })
    const container = await render("chat-1")
    expect(container.textContent).not.toContain("other chat")
    expect(container.textContent).toContain("Running...")
  })

  test("returns to the generic indicator once the block is cleared", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: "streaming" })
    const container = await render()
    expect(container.textContent).toContain("streaming")
    await act(async () => {
      useLiveBlockStore.getState().setLiveBlock("chat-1", null)
    })
    expect(container.textContent).toContain("Running...")
  })
})
