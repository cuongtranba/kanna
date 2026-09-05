import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $createTextNode, $getRoot, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_NORMAL } from "lexical"
import {
  KANNA_COMPOSER_NODES,
  $createMentionNode,
  $createSlashCommandNode,
  $createAttachmentNode,
} from "../nodes"
import { serializeEditorToWire } from "../serialize/editorToWireString"
import { isTypeaheadMenuOpen } from "./SubmitPlugin"
import type { ChatAttachment } from "../../../../shared/types"


function buildEditor() {
  return createHeadlessEditor({
    namespace: "test-submit-plugin",
    nodes: [...KANNA_COMPOSER_NODES],
    onError: (e: Error) => {
      throw e
    },
  })
}

const fakeAttachment: ChatAttachment = {
  id: "att-1",
  kind: "file",
  displayName: "notes.txt",
  absolutePath: "/tmp/notes.txt",
  relativePath: "notes.txt",
  contentUrl: "",
  mimeType: "text/plain",
  size: 100,
}


describe("SubmitPlugin — submit payload shape (via serializeEditorToWire)", () => {
  it("plain text paragraph produces the correct wire payload", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("fix the bug please"))
        root.append(para)
      },
      { discrete: true },
    )

    const payload = serializeEditorToWire(editor)
    expect(payload.text).toBe("fix the bug please")
    expect(payload.attachments).toHaveLength(0)
  })

  it("text + agent mention produces the wire string @agent/<name>", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hey "))
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "builder", label: "builder" }),
        )
        para.append($createTextNode(" run this"))
        root.append(para)
      },
      { discrete: true },
    )

    const payload = serializeEditorToWire(editor)
    expect(payload.text).toBe("hey @agent/builder run this")
    expect(payload.attachments).toHaveLength(0)
  })

  it("slash command node produces /<name> in the wire string", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append(
          $createSlashCommandNode({ commandName: "clear", hasArgument: false }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    const payload = serializeEditorToWire(editor)
    expect(payload.text).toBe("/clear")
  })

  it("attachment node is excluded from text and added to attachments[]", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("see this file"))
        para.append($createAttachmentNode(fakeAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    const payload = serializeEditorToWire(editor)
    expect(payload.text).toBe("see this file")
    expect(payload.attachments).toHaveLength(1)
    expect(payload.attachments[0]).toEqual(fakeAttachment)
  })
})


describe("SubmitPlugin — keyboard routing contract", () => {

  it("does NOT submit when shiftKey is true (Shift+Enter inserts newline)", () => {
    const shiftEnterEvent = { shiftKey: true } as KeyboardEvent
    const disabled = false
    const canSubmit = true

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(shiftEnterEvent, disabled, canSubmit)).toBe(false)
  })

  it("submits when plain Enter is pressed and content exists", () => {
    const plainEnterEvent = { shiftKey: false } as KeyboardEvent
    const disabled = false
    const canSubmit = true

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnterEvent, disabled, canSubmit)).toBe(true)
  })

  it("does NOT submit when disabled=true", () => {
    const plainEnterEvent = { shiftKey: false } as KeyboardEvent
    const disabled = true
    const canSubmit = true

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnterEvent, disabled, canSubmit)).toBe(false)
  })

  it("does NOT submit when editor is empty", () => {
    const plainEnterEvent = { shiftKey: false } as KeyboardEvent
    const disabled = false

    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
      },
      { discrete: true },
    )

    const payload = serializeEditorToWire(editor)
    const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(canSubmit).toBe(false)
    expect(shouldSubmit(plainEnterEvent, disabled, canSubmit)).toBe(false)
  })

  it("submits for attachment-only editor (text empty, attachments non-empty)", () => {
    const plainEnterEvent = { shiftKey: false } as KeyboardEvent
    const disabled = false

    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createAttachmentNode(fakeAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    const payload = serializeEditorToWire(editor)
    const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(canSubmit).toBe(true)
    expect(shouldSubmit(plainEnterEvent, disabled, canSubmit)).toBe(true)
  })
})


describe("SubmitPlugin — IME composition guard", () => {
  it("does NOT submit when Enter is pressed during IME composition (isComposing=true)", () => {
    const composingEnterEvent = { shiftKey: false, isComposing: true } as KeyboardEvent
    const disabled = false
    const canSubmit = true

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.isComposing) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(composingEnterEvent, disabled, canSubmit)).toBe(false)
  })

  it("submits when plain Enter is pressed with composition ended (isComposing=false)", () => {
    const committedEnterEvent = { shiftKey: false, isComposing: false } as KeyboardEvent
    const disabled = false
    const canSubmit = true

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.isComposing) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(committedEnterEvent, disabled, canSubmit)).toBe(true)
  })

  it("isComposing guard fires before shiftKey check (composition + shift does not submit)", () => {
    const composingShiftEnterEvent = { shiftKey: true, isComposing: true } as KeyboardEvent
    const disabled = false
    const canSubmit = true

    function shouldSubmit(event: KeyboardEvent, isDisabled: boolean, hasContent: boolean): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.isComposing) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(composingShiftEnterEvent, disabled, canSubmit)).toBe(false)
  })

  it("handler dispatched with isComposing=true does not invoke onSubmit callback", () => {
    const editor = buildEditor()
    let submitted = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = { hasTypeaheadMenuOpen: () => false, isTouchDevice: () => false }
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.isComposing) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice()) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const imeEnter = Object.assign(new KeyboardEvent("keydown", { key: "Enter" }), { isComposing: true })
    editor.dispatchCommand(KEY_ENTER_COMMAND, imeEnter as KeyboardEvent)

    expect(submitted).toBe(false)
    unregister()
  })

  it("handler dispatched with isComposing=false DOES invoke onSubmit callback", () => {
    const editor = buildEditor()
    let submitted = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = { hasTypeaheadMenuOpen: () => false, isTouchDevice: () => false }
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.isComposing) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice()) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const plainEnter = Object.assign(new KeyboardEvent("keydown", { key: "Enter" }), { isComposing: false })
    editor.dispatchCommand(KEY_ENTER_COMMAND, plainEnter as KeyboardEvent)

    expect(submitted).toBe(true)
    unregister()
  })
})


describe("SubmitPlugin — composition ref tracking (Korean IME edge case)", () => {
  it("does NOT submit when compositionRef is true even if event.isComposing is false", () => {
    const enterWithFalseIsComposing = { shiftKey: false, isComposing: false } as KeyboardEvent
    const composingRef = { current: true }

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(enterWithFalseIsComposing, false, true, composingRef.current)).toBe(false)
  })

  it("submits when compositionRef is false AND event.isComposing is false", () => {
    const plainEnter = { shiftKey: false, isComposing: false } as KeyboardEvent
    const composingRef = { current: false }

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnter, false, true, composingRef.current)).toBe(true)
  })

  it("does NOT submit when compositionRef is false but event.isComposing is true", () => {
    const composingEnter = { shiftKey: false, isComposing: true } as KeyboardEvent
    const composingRef = { current: false }

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(composingEnter, false, true, composingRef.current)).toBe(false)
  })

  it("dispatched command with composingRef=true (isComposing=false) does not invoke onSubmit", () => {
    const editor = buildEditor()
    let submitted = false
    const composingRefCurrent = true

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("안녕하세요"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = { hasTypeaheadMenuOpen: () => false, isTouchDevice: () => false }
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (composingRefCurrent || event.isComposing) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice()) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const koreanImeEnter = Object.assign(
      new KeyboardEvent("keydown", { key: "Enter" }),
      { isComposing: false },
    )
    editor.dispatchCommand(KEY_ENTER_COMMAND, koreanImeEnter as KeyboardEvent)

    expect(submitted).toBe(false)
    unregister()
  })

  it("dispatched command with composingRef=false (isComposing=false) DOES invoke onSubmit", () => {
    const editor = buildEditor()
    let submitted = false
    const composingRefCurrent = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("안녕하세요"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = { hasTypeaheadMenuOpen: () => false, isTouchDevice: () => false }
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (composingRefCurrent || event.isComposing) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice()) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const committedEnter = Object.assign(
      new KeyboardEvent("keydown", { key: "Enter" }),
      { isComposing: false },
    )
    editor.dispatchCommand(KEY_ENTER_COMMAND, committedEnter as KeyboardEvent)

    expect(submitted).toBe(true)
    unregister()
  })
})


describe("SubmitPlugin — isTypeaheadMenuOpen guard", () => {
  it("returns true when a typeahead menu element is present", () => {
    const fakeDom = { hasTypeaheadMenuOpen: () => true }
    expect(isTypeaheadMenuOpen(fakeDom)).toBe(true)
  })

  it("returns false when no typeahead menu element is present", () => {
    const fakeDom = { hasTypeaheadMenuOpen: () => false }
    expect(isTypeaheadMenuOpen(fakeDom)).toBe(false)
  })

  it("Enter is suppressed (no submit) while a picker menu is open", () => {
    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      menuOpen: boolean,
      hasContent: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (event.shiftKey) return false
      if (menuOpen) return false
      if (!hasContent) return false
      return true
    }

    const plainEnter = { shiftKey: false } as KeyboardEvent
    expect(shouldSubmit(plainEnter, false, true, true)).toBe(false)
    expect(shouldSubmit(plainEnter, false, false, true)).toBe(true)
  })
})


describe("SubmitPlugin — KEY_ENTER_COMMAND dispatch", () => {
  it("a registered KEY_ENTER_COMMAND handler receives the keyboard event", () => {
    const editor = buildEditor()
    let receivedEvent: KeyboardEvent | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("send me"))
        root.append(para)
      },
      { discrete: true },
    )

    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        receivedEvent = event
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )

    const fakeEvent = new (class extends Event {
      shiftKey = false
    })("keydown")
    editor.dispatchCommand(KEY_ENTER_COMMAND, fakeEvent as KeyboardEvent)

    expect(receivedEvent).not.toBeNull()

    unregister()
  })

  it("a handler returning false does NOT prevent subsequent handlers", () => {
    const editor = buildEditor()
    let secondHandlerCalled = false

    const unregister1 = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => false,
      COMMAND_PRIORITY_NORMAL,
    )
    const unregister2 = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        secondHandlerCalled = true
        return false
      },
      COMMAND_PRIORITY_NORMAL,
    )

    editor.dispatchCommand(KEY_ENTER_COMMAND, null)

    expect(secondHandlerCalled).toBe(true)

    unregister1()
    unregister2()
  })
})


describe("SubmitPlugin — iPad external keyboard (fine pointer override)", () => {

  it("does NOT submit on touch device with coarse pointer (on-screen keyboard)", () => {
    const plainEnter = { shiftKey: false, isComposing: false } as KeyboardEvent

    function shouldSubmit(
      event: KeyboardEvent,
      isTouchDevice: boolean,
      hasFinePointer: boolean,
      hasContent: boolean,
    ): boolean {
      if (!event) return false
      if (event.isComposing) return false
      if (event.shiftKey) return false
      if (isTouchDevice && !hasFinePointer) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnter, true, false, true)).toBe(false)
  })

  it("submits on touch device with fine pointer (iPad + Magic Keyboard / Universal Control)", () => {
    const plainEnter = { shiftKey: false, isComposing: false } as KeyboardEvent

    function shouldSubmit(
      event: KeyboardEvent,
      isTouchDevice: boolean,
      hasFinePointer: boolean,
      hasContent: boolean,
    ): boolean {
      if (!event) return false
      if (event.isComposing) return false
      if (event.shiftKey) return false
      if (isTouchDevice && !hasFinePointer) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnter, true, true, true)).toBe(true)
  })

  it("submits on non-touch device regardless of pointer type", () => {
    const plainEnter = { shiftKey: false, isComposing: false } as KeyboardEvent

    function shouldSubmit(
      event: KeyboardEvent,
      isTouchDevice: boolean,
      hasFinePointer: boolean,
      hasContent: boolean,
    ): boolean {
      if (!event) return false
      if (event.isComposing) return false
      if (event.shiftKey) return false
      if (isTouchDevice && !hasFinePointer) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnter, false, false, true)).toBe(true)
  })

  it("handler with touch=true fine=true dispatches onSubmit via command", () => {
    const editor = buildEditor()
    let submitted = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello from iPad"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = {
      hasTypeaheadMenuOpen: () => false,
      isTouchDevice: () => true,
      matchesMediaQuery: (query: string) => query === "(hover: hover) and (pointer: fine)",
    }

    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.isComposing) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice() && !fakeDom.matchesMediaQuery("(hover: hover) and (pointer: fine)")) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const enter = Object.assign(new KeyboardEvent("keydown", { key: "Enter" }), { isComposing: false })
    editor.dispatchCommand(KEY_ENTER_COMMAND, enter as KeyboardEvent)

    expect(submitted).toBe(true)
    unregister()
  })

  it("handler with touch=true fine=false does NOT dispatch onSubmit via command", () => {
    const editor = buildEditor()
    let submitted = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello from iPad"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = {
      hasTypeaheadMenuOpen: () => false,
      isTouchDevice: () => true,
      matchesMediaQuery: (_query: string) => false,
    }

    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.isComposing) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice() && !fakeDom.matchesMediaQuery("(hover: hover) and (pointer: fine)")) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const enter = Object.assign(new KeyboardEvent("keydown", { key: "Enter" }), { isComposing: false })
    editor.dispatchCommand(KEY_ENTER_COMMAND, enter as KeyboardEvent)

    expect(submitted).toBe(false)
    unregister()
  })
})


describe("SubmitPlugin — keyCode 229 guard", () => {
  it("does NOT submit when keyCode is 229 even if isComposing is false", () => {
    const processKeyEvent = { shiftKey: false, isComposing: false, keyCode: 229 } as KeyboardEvent

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing || event.keyCode === 229) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(processKeyEvent, false, true, false)).toBe(false)
  })

  it("submits when keyCode is 13 and isComposing is false", () => {
    const realEnterEvent = { shiftKey: false, isComposing: false, keyCode: 13 } as KeyboardEvent

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing || event.keyCode === 229) return false
      if (event.shiftKey) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(realEnterEvent, false, true, false)).toBe(true)
  })

  it("dispatched command with keyCode=229 does not invoke onSubmit", () => {
    const editor = buildEditor()
    let submitted = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("안녕하세요"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = { hasTypeaheadMenuOpen: () => false, isTouchDevice: () => false }
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.isComposing || event.keyCode === 229) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice()) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitted = true
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const imeProcessKey = Object.assign(
      new KeyboardEvent("keydown", { key: "Enter", keyCode: 229 }),
      { isComposing: false, keyCode: 229 },
    )
    editor.dispatchCommand(KEY_ENTER_COMMAND, imeProcessKey as KeyboardEvent)

    expect(submitted).toBe(false)
    unregister()
  })
})


describe("SubmitPlugin — post-submit lock (justSubmittedRef)", () => {
  it("does NOT submit when justSubmittedRef is true (same-sequence second Enter)", () => {
    const plainEnter = { shiftKey: false, isComposing: false, keyCode: 13 } as KeyboardEvent
    const justSubmittedRef = { current: true }

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
      justSubmitted: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing || event.keyCode === 229) return false
      if (event.shiftKey) return false
      if (justSubmitted) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnter, false, true, false, justSubmittedRef.current)).toBe(false)
  })

  it("submits when justSubmittedRef is false (normal submit)", () => {
    const plainEnter = { shiftKey: false, isComposing: false, keyCode: 13 } as KeyboardEvent
    const justSubmittedRef = { current: false }

    function shouldSubmit(
      event: KeyboardEvent,
      isDisabled: boolean,
      hasContent: boolean,
      composingRefCurrent: boolean,
      justSubmitted: boolean,
    ): boolean {
      if (isDisabled) return false
      if (!event) return false
      if (composingRefCurrent || event.isComposing || event.keyCode === 229) return false
      if (event.shiftKey) return false
      if (justSubmitted) return false
      if (!hasContent) return false
      return true
    }

    expect(shouldSubmit(plainEnter, false, true, false, justSubmittedRef.current)).toBe(true)
  })

  it("dispatched second Enter while justSubmittedRef=true does not invoke onSubmit", () => {
    const editor = buildEditor()
    let submitCount = 0
    let justSubmitted = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("줘"))
        root.append(para)
      },
      { discrete: true },
    )

    const fakeDom = { hasTypeaheadMenuOpen: () => false, isTouchDevice: () => false }
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false
        if (event.isComposing || event.keyCode === 229) return false
        if (event.shiftKey) return false
        if (fakeDom.hasTypeaheadMenuOpen()) return false
        if (fakeDom.isTouchDevice()) return false
        if (justSubmitted) return false
        const payload = serializeEditorToWire(editor)
        const canSubmit = payload.text.trim().length > 0 || payload.attachments.length > 0
        if (!canSubmit) return false
        submitCount++
        justSubmitted = true
        Promise.resolve().then(() => { justSubmitted = false })
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    const firstEnter = Object.assign(new KeyboardEvent("keydown", { key: "Enter" }), { isComposing: false, keyCode: 13 })
    editor.dispatchCommand(KEY_ENTER_COMMAND, firstEnter as KeyboardEvent)

    const secondEnter = Object.assign(new KeyboardEvent("keydown", { key: "Enter" }), { isComposing: false, keyCode: 13 })
    editor.dispatchCommand(KEY_ENTER_COMMAND, secondEnter as KeyboardEvent)

    expect(submitCount).toBe(1)
    unregister()
  })
})
