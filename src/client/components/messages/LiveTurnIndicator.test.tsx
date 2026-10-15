import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { useLiveBlockStore } from "../../stores/liveBlockStore"
import { makeFakeDomPort, makeFakeTimerPort, type FakeTimerPort } from "../../adapters/testing/makeFakePorts"
import { ThemeProvider } from "../../hooks/useTheme"
import { LiveTurnIndicator, type LiveTurnPorts } from "./LiveTurnIndicator"
import { TextMessage } from "./TextMessage"

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  useLiveBlockStore.setState({ byChat: {} })
})

const SENTENCE = "The quick brown fox jumps over the lazy dog"
const WORD_RUN = /^[\p{L}\p{N}\p{M}'’]*/u
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

async function render(chatId: string | null = "chat-1", ports?: LiveTurnPorts) {
  const rendered = await renderClientMarkup(
    <ThemeProvider>
      <LiveTurnIndicator chatId={chatId} status="running" ports={ports} />
    </ThemeProvider>,
  )
  cleanups.push(rendered.cleanup)
  return rendered.container
}

function typingPorts() {
  const timer = makeFakeTimerPort()
  return { timer, ports: { timer, dom: makeFakeDomPort() } }
}

function reducedMotionPorts(): LiveTurnPorts {
  return { timer: makeFakeTimerPort(), dom: makeFakeDomPort({ reducedMotion: true }) }
}

async function setText(text: string) {
  await act(async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text })
  })
}

async function flushFrame(timer: FakeTimerPort, timestamp: number) {
  let ran = 0
  await act(async () => {
    ran = timer.flushAnimationFrames(timestamp)
  })
  return ran
}

async function flushUntilCaughtUp(timer: FakeTimerPort, startAt = 0) {
  let timestamp = startAt
  for (let guard = 0; guard < 1000; guard++) {
    timestamp += 16
    if ((await flushFrame(timer, timestamp)) === 0) return timestamp
  }
  throw new Error("animation frames never settled")
}

function ghostOf(container: HTMLElement) {
  return container.querySelector("[data-testid='live-ghost']")
}

function caretOf(container: HTMLElement) {
  return container.querySelector("[data-testid='live-caret']")
}

const BLOCK_ELEMENTS = "p, ul, ol, pre, h1, h2, h3, h4, h5, h6, div.no-code-highlight"

function blockSequence(root: Element) {
  return Array.from(root.querySelectorAll(BLOCK_ELEMENTS)).map(
    (element) => `${element.tagName} ${element.className} ${element.textContent}`,
  )
}

function visibleText(container: HTMLElement) {
  const full = container.querySelector("[data-testid='live-block-text']")?.textContent ?? ""
  const ghost = ghostOf(container)?.textContent ?? ""
  return full.slice(0, full.length - ghost.length)
}

describe("LiveTurnIndicator", () => {
  test("falls back to the generic running indicator when nothing is streaming", async () => {
    const container = await render()
    expect(container.textContent).toContain("Running...")
  })

  test("shows streamed assistant text as markdown", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: "Here is **bold** text" })
    const container = await render("chat-1", reducedMotionPorts())
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
    const container = await render("chat-1", reducedMotionPorts())
    expect(container.textContent).toContain("streaming")
    await act(async () => {
      useLiveBlockStore.getState().setLiveBlock("chat-1", null)
    })
    expect(container.textContent).toContain("Running...")
  })

  test("reveals the latest snapshot as a growing prefix with a solid caret", async () => {
    const { timer, ports } = typingPorts()
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: SENTENCE })
    const container = await render("chat-1", ports)
    await flushFrame(timer, 16)
    await flushFrame(timer, 32)
    const partial = visibleText(container)
    expect(partial.length).toBeGreaterThan(0)
    expect(partial.length).toBeLessThan(SENTENCE.length)
    expect(SENTENCE.startsWith(partial)).toBe(true)
    expect(caretOf(container)?.getAttribute("data-caret")).toBe("revealing")
  })

  test("shows the whole snapshot and a blinking caret once the reveal has caught up", async () => {
    const { timer, ports } = typingPorts()
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: SENTENCE })
    const container = await render("chat-1", ports)
    await flushUntilCaughtUp(timer)
    expect(visibleText(container)).toBe(SENTENCE)
    expect(caretOf(container)?.getAttribute("data-caret")).toBe("idle")
  })

  test("never shows half a grapheme, even when a snapshot ends inside an emoji sequence", async () => {
    const final = "Tiếng Việt 👩‍💻"
    const graphemes = Array.from(segmenter.segment(final), (part) => part.segment)
    const wholePrefixes = new Set(["", ...graphemes.map((_, index) => graphemes.slice(0, index + 1).join(""))])
    const { timer, ports } = typingPorts()
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: "Tiếng Việt 👩\u200D" })
    const container = await render("chat-1", ports)
    const seen: string[] = []
    let timestamp = 0
    for (const snapshot of [undefined, final]) {
      if (snapshot !== undefined) await setText(snapshot)
      for (let ran = 1; ran > 0; ) {
        timestamp += 16
        ran = await flushFrame(timer, timestamp)
        seen.push(visibleText(container))
      }
    }
    expect(seen.filter((text) => !wholePrefixes.has(text))).toEqual([])
    expect(seen[seen.length - 1]).toBe(final)
  })

  test("holds the rest of the current word invisibly right after the caret", async () => {
    const snapshot = "Hello wonderful world"
    const { timer, ports } = typingPorts()
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: snapshot })
    const container = await render("chat-1", ports)
    await flushFrame(timer, 16)
    await flushFrame(timer, 32)
    const visible = visibleText(container)
    const restOfWord = snapshot.slice(visible.length).match(WORD_RUN)?.[0] ?? ""
    const ghost = ghostOf(container)
    expect(restOfWord.length).toBeGreaterThan(0)
    expect(ghost?.textContent).toBe(restOfWord)
    expect(caretOf(container)?.nextElementSibling).toBe(ghost)
  })

  test("shows every snapshot in full with a steady caret when motion is reduced", async () => {
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: SENTENCE })
    const container = await render("chat-1", reducedMotionPorts())
    expect(visibleText(container)).toBe(SENTENCE)
    expect(caretOf(container)?.getAttribute("data-caret")).toBe("still")
  })

  test("jumps to the end of a tail-sliced snapshot instead of retyping it", async () => {
    const { timer, ports } = typingPorts()
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: "Hello wonderful world" })
    const container = await render("chat-1", ports)
    await flushFrame(timer, 16)
    const sliced = "…rful world and more"
    await setText(sliced)
    expect(visibleText(container)).toBe(sliced)
  })

  test("shows a code block whole instead of typing it", async () => {
    const intro = "Intro line"
    const snapshot = `${intro}\n\n\`\`\`ts\nconst answer = 42\nconsole.log(answer)\n`
    const { timer, ports } = typingPorts()
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: snapshot })
    const container = await render("chat-1", ports)
    const codeSeen: string[] = []
    const proseSeen: string[] = []
    let timestamp = 0
    for (let ran = 1; ran > 0; ) {
      timestamp += 16
      ran = await flushFrame(timer, timestamp)
      const code = container.querySelector("code")?.textContent
      if (code !== undefined) codeSeen.push(code)
      proseSeen.push(visibleText(container))
    }
    const wholeCode = codeSeen[codeSeen.length - 1] ?? ""
    expect(wholeCode).toContain("const answer = 42\nconsole.log(answer)")
    expect(codeSeen.filter((code) => code !== wholeCode)).toEqual([])
    expect(proseSeen.some((text) => text.length > 0 && text.length < intro.length && intro.startsWith(text))).toBe(true)
  })

  test("lays out a caught-up reply exactly like the settled message, so the hand-off does not jump", async () => {
    const reply = "para1\n\npara2\n\n- a\n- b\n- c\n\n```ts\ncode\n```\n\nlast para"
    useLiveBlockStore.getState().setLiveBlock("chat-1", { kind: "text", text: reply })
    const live = await render("chat-1", reducedMotionPorts())
    const settled = await renderClientMarkup(
      <ThemeProvider>
        <TextMessage message={{ kind: "assistant_text", text: reply, id: "id-1", timestamp: "2024-01-01T00:00:00Z" }} />
      </ThemeProvider>,
    )
    cleanups.push(settled.cleanup)
    live.querySelectorAll("[data-testid='live-caret'], [data-testid='live-ghost']").forEach((node) => node.remove())
    const settledBlocks = blockSequence(settled.container)
    expect(settledBlocks.length).toBeGreaterThan(6)
    expect(blockSequence(live)).toEqual(settledBlocks)
  })
})
