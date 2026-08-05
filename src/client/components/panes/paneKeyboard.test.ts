import { describe, expect, test } from "bun:test"
import {
  DEFAULT_KEYBINDINGS,
  type KeybindingsSnapshot,
} from "../../../shared/app-settings-types"
import { isTypingTarget, resolvePaneCommand } from "./paneKeyboard"

const KEYBINDINGS: KeybindingsSnapshot = {
  bindings: { ...DEFAULT_KEYBINDINGS },
  warning: null,
  filePathDisplay: "",
}

interface FakeKeyInit {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

function keyEvent({ key, meta = false, ctrl = false, alt = false, shift = false }: FakeKeyInit) {
  return {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    metaKey: meta,
    ctrlKey: ctrl,
    altKey: alt,
    shiftKey: shift,
  } as KeyboardEvent
}

describe("resolvePaneCommand", () => {
  test("maps the directional bindings to a focus command", () => {
    const cases = [
      ["ArrowLeft", "left"],
      ["ArrowRight", "right"],
      ["ArrowUp", "up"],
      ["ArrowDown", "down"],
    ] as const

    for (const [key, direction] of cases) {
      const event = keyEvent({ key, meta: true, ctrl: true })
      expect(resolvePaneCommand(KEYBINDINGS, event, false)).toEqual({ kind: "focus", direction })
    }
  })

  test("maps the split bindings to a split command", () => {
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "d", meta: true, ctrl: true }), false)).toEqual({
      kind: "split",
      position: "right",
    })
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "e", meta: true, ctrl: true }), false)).toEqual({
      kind: "split",
      position: "bottom",
    })
  })

  test("maps the close binding", () => {
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "w", meta: true, ctrl: true }), false)).toEqual({
      kind: "closeTab",
    })
  })

  test("maps tab cycling in both directions", () => {
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "j", meta: true, ctrl: true }), false)).toEqual({
      kind: "cycleTab",
      delta: 1,
    })
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "k", meta: true, ctrl: true }), false)).toEqual({
      kind: "cycleTab",
      delta: -1,
    })
  })

  test("returns null for an unrelated combination", () => {
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "b", meta: true }), false)).toBeNull()
  })

  test("returns null for the bare key without its modifiers", () => {
    expect(resolvePaneCommand(KEYBINDINGS, keyEvent({ key: "d" }), false)).toBeNull()
  })

  test("still fires a modifier binding while the user is typing", () => {
    // Every default is a modifier combo, and a terminal or composer holds focus
    // most of the time. Suppressing these while typing would make pane
    // navigation unreachable from exactly the place you need it.
    const event = keyEvent({ key: "ArrowRight", meta: true, ctrl: true })

    expect(resolvePaneCommand(KEYBINDINGS, event, true)).toEqual({ kind: "focus", direction: "right" })
  })

  test("suppresses a modifier-less rebind while the user is typing", () => {
    // A user may rebind to a bare letter; that must not eat their keystrokes.
    const snapshot: KeybindingsSnapshot = {
      ...KEYBINDINGS,
      bindings: { ...DEFAULT_KEYBINDINGS, closePaneTab: ["q"] },
    }
    const event = keyEvent({ key: "q" })

    expect(resolvePaneCommand(snapshot, event, false)).toEqual({ kind: "closeTab" })
    expect(resolvePaneCommand(snapshot, event, true)).toBeNull()
  })

  test("tolerates a null snapshot by falling back to defaults", () => {
    const event = keyEvent({ key: "ArrowLeft", meta: true, ctrl: true })

    expect(resolvePaneCommand(null, event, false)).toEqual({ kind: "focus", direction: "left" })
  })
})

describe("isTypingTarget", () => {
  test("treats inputs, textareas and contenteditable as typing surfaces", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true)
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true)
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true)
  })

  test("treats ordinary elements and a missing target as not typing", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false)
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
