import { describe, expect, test } from "bun:test"
import { bindingMatchesEvent, findMatchingActionBinding, parseKeybindingInput } from "./keybindings"
import type { KeybindingsSnapshot } from "../../shared/types"

describe("parseKeybindingInput", () => {
  test("splits comma-separated values, trims whitespace, and lowercases", () => {
    expect(parseKeybindingInput(" Cmd+J, Ctrl+` ,  ")).toEqual(["cmd+j", "ctrl+`"])
  })
})

describe("bindingMatchesEvent", () => {
  test("matches modifier bindings case-insensitively", () => {
    const event = { key: "j", code: "KeyJ", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false } as KeyboardEvent
    expect(bindingMatchesEvent("Cmd+J", event)).toBe(true)
  })

  test("does not match when modifiers differ", () => {
    const event = { key: "b", code: "KeyB", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true } as KeyboardEvent
    expect(bindingMatchesEvent("Ctrl+B", event)).toBe(false)
  })

  test("matches option-modified letters by physical key code", () => {
    const event = { key: "ø", code: "KeyO", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false } as KeyboardEvent
    expect(bindingMatchesEvent("Cmd+Alt+O", event)).toBe(true)
  })
})

describe("findMatchingActionBinding", () => {
  test("returns the matching binding for multi-binding actions", () => {
    const snapshot: KeybindingsSnapshot = {
      bindings: {
        toggleEmbeddedTerminal: ["cmd+j"],
        toggleRightSidebar: ["cmd+b"],
        openInFinder: ["cmd+alt+f"],
        openInEditor: ["cmd+shift+o"],
        addSplitTerminal: ["cmd+/"],
        jumpToSidebarChat: ["cmd+alt"],
        createChatInCurrentProject: ["cmd+alt+n"],
        openAddProject: ["cmd+alt+o"],
        newStack: ["cmd+alt+w"],
        newStackChat: ["cmd+alt+shift+n"],
        jumpToStacks: ["g s"],
      },
      warning: null,
      filePathDisplay: "~/.kanna/keybindings.json",
    }
    const event = { key: "˜", code: "KeyN", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false } as KeyboardEvent

    expect(findMatchingActionBinding(snapshot, "createChatInCurrentProject", event)).toBe("cmd+alt+n")
  })
})
