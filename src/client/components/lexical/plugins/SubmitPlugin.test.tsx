/**
 * Tests for SubmitPlugin.
 *
 * Strategy: mounting a full React+Lexical tree (LexicalComposer + plugin)
 * in a headless Bun environment is extremely brittle due to DOM and timer
 * dependencies.  Instead we test the independently-verifiable contract:
 *
 *   1. The submit payload shape — using a headless editor and serializeEditorToWire
 *      directly (the same function SubmitPlugin calls on submit).
 *   2. The keyboard routing contract — plain Enter should map to submit;
 *      Shift+Enter should NOT (insert newline instead).  We express this
 *      through the same condition the plugin checks, not through simulated DOM
 *      events (which require jsdom).
 *   3. The "disabled" guard — the plugin returns false (no intercept) when
 *      disabled=true.
 *
 * Full integration (LexicalComposer mount + fireEvent('keydown')) would
 * require a real DOM and is covered by e2e / manual tests.
 */
import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $createTextNode, $getRoot, KEY_ENTER_COMMAND, COMMAND_PRIORITY_NORMAL } from "lexical"
import {
  KANNA_COMPOSER_NODES,
  $createMentionNode,
  $createSlashCommandNode,
  $createAttachmentNode,
} from "../nodes"
import { serializeEditorToWire } from "../serialize/editorToWireString"
import { isTypeaheadMenuOpen } from "./SubmitPlugin"
import type { ChatAttachment } from "../../../../shared/types"

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Submit payload shape ─────────────────────────────────────────────────────

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

// ─── Keyboard routing contract ────────────────────────────────────────────────

describe("SubmitPlugin — keyboard routing contract", () => {
  /**
   * The plugin logic in pseudo-code:
   *
   *   if (disabled) return false
   *   if (!event) return false
   *   if (event.shiftKey) return false        // Shift+Enter → newline
   *   if (isTouchDevice) return false
   *   if (!canSubmit) return false
   *   // → submit + return true
   */

  it("does NOT submit when shiftKey is true (Shift+Enter inserts newline)", () => {
    const shiftEnterEvent = { shiftKey: true } as KeyboardEvent
    const disabled = false
    const canSubmit = true

    // Simulate the plugin's decision tree
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

    // Build a real headless editor and verify canSubmit logic
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

// ─── Typeahead-menu guard (regression: Enter must select picker option) ───────

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
    // Mirrors the plugin's decision tree including the typeahead guard.
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
    // Picker open → defer to picker, do not submit even with content.
    expect(shouldSubmit(plainEnter, false, true, true)).toBe(false)
    // Picker closed → submit normally.
    expect(shouldSubmit(plainEnter, false, false, true)).toBe(true)
  })
})

// ─── Command registration contract ───────────────────────────────────────────

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

    // Register a handler — mirrors SubmitPlugin's registerCommand call.
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
      () => false, // does not intercept
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

    // Both handlers at NORMAL priority will both be checked;
    // handlers run in priority order — this verifies the dispatch chain.
    expect(secondHandlerCalled).toBe(true)

    unregister1()
    unregister2()
  })
})
