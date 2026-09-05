import { afterEach, describe, expect, test } from "bun:test"
import { flyChatTitleToTab } from "./titleFlip.adapter"

/**
 * The carry's contract is almost entirely about what it leaves behind.
 *
 * A clone that outlives its animation is duplicated text floating over the app
 * with nothing to dismiss it — strictly worse than no flourish at all — so
 * every path here is asserted to end with an empty body, including the paths
 * where the animation never runs.
 */

const CHAT_ID = "chat-123"

function buildRow(chatId: string, title: string): HTMLElement {
  const row = document.createElement("div")
  row.setAttribute("data-chat-id", chatId)
  const span = document.createElement("span")
  span.className = "min-w-0 flex-1 truncate text-sm"
  span.textContent = title
  row.appendChild(span)
  return row
}

function buildTab(chatId: string, title: string): HTMLElement {
  const tab = document.createElement("div")
  tab.setAttribute("data-tab-id", chatId)
  const span = document.createElement("span")
  span.className = "min-w-0 flex-1 truncate text-xs"
  span.textContent = title
  tab.appendChild(span)
  return tab
}

/** happy-dom lays nothing out, so rects are stubbed to be non-degenerate. */
function withRect(element: HTMLElement, left: number, top: number): HTMLElement {
  const span = element.querySelector("span")
  if (span) {
    span.getBoundingClientRect = () =>
      ({ left, top, width: 120, height: 16, right: left + 120, bottom: top + 16, x: left, y: top, toJSON: () => ({}) })
  }
  return element
}

/** A frame pump that never yields to a real rAF, so a miss cannot hang. */
const immediateRaf = (callback: () => void) => { callback() }

afterEach(() => {
  document.body.innerHTML = ""
})

describe("flyChatTitleToTab", () => {
  test("leaves nothing behind after a completed carry", async () => {
    document.body.appendChild(withRect(buildRow(CHAT_ID, "Fix the parser"), 12, 300))
    document.body.appendChild(withRect(buildTab(CHAT_ID, "Fix the parser"), 320, 40))

    await flyChatTitleToTab(CHAT_ID, { root: document, raf: immediateRaf })

    expect(document.querySelectorAll("[aria-hidden='true']")).toHaveLength(0)
    expect(document.body.children).toHaveLength(2)
  })

  test("gives up silently when the tab never appears", async () => {
    // Only the sidebar row exists — the route never settled, or the chat
    // opened somewhere with no tab strip. Costs the flourish, nothing else.
    document.body.appendChild(withRect(buildRow(CHAT_ID, "Fix the parser"), 12, 300))

    let elapsed = 0
    await flyChatTitleToTab(CHAT_ID, {
      root: document,
      raf: immediateRaf,
      now: () => { elapsed += 100; return elapsed },
    })

    expect(document.body.children).toHaveLength(1)
  })

  test("gives up when neither end exists", async () => {
    let elapsed = 0
    await flyChatTitleToTab(CHAT_ID, {
      root: document,
      raf: immediateRaf,
      now: () => { elapsed += 100; return elapsed },
    })
    expect(document.body.children).toHaveLength(0)
  })

  test("an unpainted end is not flown to", async () => {
    // A zero-width rect means laid out but not painted; flying to it would
    // land the clone at the viewport origin, which reads as a glitch.
    document.body.appendChild(withRect(buildRow(CHAT_ID, "Fix the parser"), 12, 300))
    const tab = buildTab(CHAT_ID, "Fix the parser")
    const span = tab.querySelector("span")
    if (span) {
      span.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) })
    }
    document.body.appendChild(tab)

    let elapsed = 0
    await flyChatTitleToTab(CHAT_ID, {
      root: document,
      raf: immediateRaf,
      now: () => { elapsed += 100; return elapsed },
    })

    expect(document.body.children).toHaveLength(2)
  })

  test("a chat id with selector-special characters cannot break the lookup", async () => {
    // Chat ids are generated, but a lookup built by string concatenation is
    // one id away from throwing inside a detached call nobody is awaiting.
    const awkward = 'chat"1:2'
    document.body.appendChild(withRect(buildRow(awkward, "Odd"), 12, 300))
    document.body.appendChild(withRect(buildTab(awkward, "Odd"), 320, 40))

    await flyChatTitleToTab(awkward, { root: document, raf: immediateRaf })
    expect(document.body.children).toHaveLength(2)
  })
})
