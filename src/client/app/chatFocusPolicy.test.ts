import { describe, expect, test } from "bun:test"
import {
  ALLOW_FOCUS_RETAIN_ATTRIBUTE,
  FOCUS_FALLBACK_IGNORE_ATTRIBUTE,
  hasActiveFocusOverlay,
  isTextEntryTarget,
  shouldRestoreChatInputFocus,
} from "./chatFocusPolicy"

class FakeElement {
  parent: FakeElement | null
  attributes = new Map<string, string>()
  tagName: string
  tabIndex: number
  isContentEditable = false

  constructor(tagName: string, options?: { parent?: FakeElement | null; tabIndex?: number; attributes?: Record<string, string> }) {
    this.tagName = tagName.toLowerCase()
    this.parent = options?.parent ?? null
    this.tabIndex = options?.tabIndex ?? -1
    for (const [key, value] of Object.entries(options?.attributes ?? {})) {
      this.attributes.set(key, value)
    }
  }

  closest(selector: string) {
    const attributeMatch = selector.match(/^\[(.+)\]$/)
    if (!attributeMatch) return null
    const attribute = attributeMatch[1]
    let current: FakeElement | null = this
    while (current) {
      if (current.attributes.has(attribute)) return current as unknown as Element
      current = current.parent
    }
    return null
  }

  matches(selector: string) {
    if (selector === "button, a[href], summary") {
      if (this.tagName === "button" || this.tagName === "summary") return true
      return this.tagName === "a" && this.attributes.has("href")
    }
    if (selector === "input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='reset']), textarea, select") {
      if (this.tagName === "textarea" || this.tagName === "select") return true
      if (this.tagName !== "input") return false
      const type = this.attributes.get("type") ?? "text"
      return !["checkbox", "radio", "button", "submit", "reset"].includes(type)
    }
    return false
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
}

function createTree() {
  const root = new FakeElement("div")
  const chat = new FakeElement("textarea", { parent: root })
  const button = new FakeElement("button", { parent: root, tabIndex: 0 })
  const random = new FakeElement("div", { parent: root })
  const otherInput = new FakeElement("input", { parent: root })
  const custom = new FakeElement("div", { parent: root, attributes: { [ALLOW_FOCUS_RETAIN_ATTRIBUTE]: "" } })
  const overlay = new FakeElement("div", { attributes: { [FOCUS_FALLBACK_IGNORE_ATTRIBUTE]: "", "data-state": "open" } })

  return {
    root: {
      contains: (other: Node | null) => [chat, button, random, otherInput, custom].includes(other as unknown as FakeElement),
    },
    chat: chat as unknown as HTMLTextAreaElement,
    button: button as unknown as Element,
    random: random as unknown as Element,
    otherInput: otherInput as unknown as Element,
    custom: custom as unknown as Element,
    overlay,
  }
}

describe("chatFocusPolicy", () => {
  test("detects text entry targets and explicit retain targets", () => {
    const { otherInput, custom, random } = createTree()

    expect(isTextEntryTarget(otherInput)).toBe(true)
    expect(isTextEntryTarget(custom)).toBe(true)
    expect(isTextEntryTarget(random)).toBe(false)
  })

  test("restores chat input after clicking a random non-focusable area", () => {
    const { root, chat, random } = createTree()

    expect(shouldRestoreChatInputFocus({
      activeElement: null,
      pointerTarget: random,
      root,
      fallback: chat,
      hasActiveOverlay: false,
    })).toBe(true)
  })

  test("restores chat input after clicking a button that took focus", () => {
    const { root, chat, button } = createTree()

    expect(shouldRestoreChatInputFocus({
      activeElement: button,
      pointerTarget: button,
      root,
      fallback: chat,
      hasActiveOverlay: false,
    })).toBe(true)
  })

  test("does not restore when another input owns focus", () => {
    const { root, chat, random, otherInput } = createTree()

    expect(shouldRestoreChatInputFocus({
      activeElement: otherInput,
      pointerTarget: random,
      root,
      fallback: chat,
      hasActiveOverlay: false,
    })).toBe(false)
  })

  test("detects active overlays from the document and skips restore while open", () => {
    const { root, chat, random, overlay } = createTree()
    const document = {
      querySelector: (selector: string) =>
        selector === `[${FOCUS_FALLBACK_IGNORE_ATTRIBUTE}][data-state='open']` ? overlay : null,
    } as Document

    expect(hasActiveFocusOverlay(document)).toBe(true)
    expect(shouldRestoreChatInputFocus({
      activeElement: null,
      pointerTarget: random,
      root,
      fallback: chat,
      hasActiveOverlay: hasActiveFocusOverlay(document),
    })).toBe(false)
  })
})
