/**
 * Tests for SnippetExpandPlugin.
 *
 * Mounting a full React+Lexical tree headlessly is brittle (see SubmitPlugin.test),
 * so we test the independently-verifiable contracts:
 *
 *   1. findSnippetForCaret — the pure matching function (exported).
 *   2. The Tab decision tree — modifiers / typeahead / empty-list guards.
 *   3. The expansion mutation — via a headless editor, applying the same
 *      spliceText + insertText/insertLineBreak steps the plugin runs, asserting
 *      the resulting wire text (single- and multi-line).
 */
import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from "lexical"
import { KANNA_COMPOSER_NODES } from "../nodes"
import { serializeEditorToWire } from "../serialize/editorToWireString"
import { findSnippetForCaret } from "./SnippetExpandPlugin"
import { isTypeaheadMenuOpen } from "./SubmitPlugin"
import type { TextSnippet } from "../../../../shared/types"

function snippet(shortcut: string, expansion: string): TextSnippet {
  return { id: `${shortcut}-id`, shortcut, expansion, createdAt: 0, updatedAt: 0 }
}

const SNIPPETS: readonly TextSnippet[] = [
  snippet("pgm", "pull request green then merge"),
  snippet("sig", "Best regards,\nAda"),
]

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test-snippet-plugin",
    nodes: [...KANNA_COMPOSER_NODES],
    onError: (e: Error) => {
      throw e
    },
  })
}

const TRAILING_TOKEN_RE = /(\S+)$/

/** Mirrors the plugin's editor.update body — the exact expansion algorithm. */
function expandInEditor(editor: ReturnType<typeof buildEditor>, snippets: readonly TextSnippet[]): boolean {
  let handled = false
  editor.update(
    () => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
      const anchor = selection.anchor
      const node = anchor.getNode()
      if (!$isTextNode(node)) return
      const offset = anchor.offset
      const textBeforeCaret = node.getTextContent().slice(0, offset)
      const match = TRAILING_TOKEN_RE.exec(textBeforeCaret)
      if (match === null) return
      const found = findSnippetForCaret(textBeforeCaret, snippets)
      if (found === null) return
      const token = match[1]
      const parts = found.expansion.split("\n")
      node.spliceText(offset - token.length, token.length, parts[0] ?? "", true)
      if (parts.length > 1) {
        const after = $getSelection()
        if (!$isRangeSelection(after)) return
        for (let index = 1; index < parts.length; index += 1) {
          after.insertLineBreak()
          const line = parts[index]
          if (line.length > 0) after.insertText(line)
        }
      }
      handled = true
    },
    { discrete: true },
  )
  return handled
}

function seedText(editor: ReturnType<typeof buildEditor>, text: string) {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const para = $createParagraphNode()
      const node = $createTextNode(text)
      para.append(node)
      root.append(para)
      node.selectEnd()
    },
    { discrete: true },
  )
}

// ─── findSnippetForCaret ──────────────────────────────────────────────────────

describe("findSnippetForCaret", () => {
  it("matches the trailing token exactly", () => {
    expect(findSnippetForCaret("pgm", SNIPPETS)?.shortcut).toBe("pgm")
  })

  it("matches only the last whitespace-free token", () => {
    expect(findSnippetForCaret("please pgm", SNIPPETS)?.shortcut).toBe("pgm")
  })

  it("returns null when the trailing token is not a shortcut", () => {
    expect(findSnippetForCaret("nope", SNIPPETS)).toBeNull()
  })

  it("returns null when text ends with whitespace (already expanded)", () => {
    expect(findSnippetForCaret("pgm ", SNIPPETS)).toBeNull()
  })

  it("returns null for empty text", () => {
    expect(findSnippetForCaret("", SNIPPETS)).toBeNull()
  })
})

// ─── Tab decision tree ────────────────────────────────────────────────────────

describe("SnippetExpandPlugin — Tab guard", () => {
  function shouldAttempt(
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean } | null,
    menuOpen: boolean,
    snippetCount: number,
  ): boolean {
    if (!event) return false
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false
    if (menuOpen) return false
    if (snippetCount === 0) return false
    return true
  }

  const plainTab = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }

  it("attempts expansion on plain Tab with snippets present", () => {
    expect(shouldAttempt(plainTab, false, 2)).toBe(true)
  })

  it("ignores Shift+Tab (plan-mode toggle)", () => {
    expect(shouldAttempt({ ...plainTab, shiftKey: true }, false, 2)).toBe(false)
  })

  it("ignores Ctrl/Meta/Alt+Tab", () => {
    expect(shouldAttempt({ ...plainTab, ctrlKey: true }, false, 2)).toBe(false)
    expect(shouldAttempt({ ...plainTab, metaKey: true }, false, 2)).toBe(false)
    expect(shouldAttempt({ ...plainTab, altKey: true }, false, 2)).toBe(false)
  })

  it("ignores Tab while a typeahead menu is open", () => {
    expect(shouldAttempt(plainTab, true, 2)).toBe(false)
  })

  it("ignores Tab when there are no snippets", () => {
    expect(shouldAttempt(plainTab, false, 0)).toBe(false)
  })

  it("isTypeaheadMenuOpen detects the menu marker", () => {
    expect(
      isTypeaheadMenuOpen({
        querySelector: (sel: string) => (sel === "[data-kanna-typeahead-menu]" ? ({} as Element) : null),
      }),
    ).toBe(true)
  })
})

// ─── Expansion mutation ───────────────────────────────────────────────────────

describe("SnippetExpandPlugin — expansion", () => {
  it("replaces a matching shortcut in place with the expansion", () => {
    const editor = buildEditor()
    seedText(editor, "pgm")
    expect(expandInEditor(editor, SNIPPETS)).toBe(true)
    expect(serializeEditorToWire(editor).text).toBe("pull request green then merge")
  })

  it("expands only the trailing token, preserving preceding text", () => {
    const editor = buildEditor()
    seedText(editor, "please pgm")
    expect(expandInEditor(editor, SNIPPETS)).toBe(true)
    expect(serializeEditorToWire(editor).text).toBe("please pull request green then merge")
  })

  it("does nothing when the trailing token is not a shortcut", () => {
    const editor = buildEditor()
    seedText(editor, "hello")
    expect(expandInEditor(editor, SNIPPETS)).toBe(false)
    expect(serializeEditorToWire(editor).text).toBe("hello")
  })

  it("inserts soft line breaks for multi-line expansions", () => {
    const editor = buildEditor()
    seedText(editor, "sig")
    expect(expandInEditor(editor, SNIPPETS)).toBe(true)
    expect(serializeEditorToWire(editor).text).toBe("Best regards,\nAda")
  })
})

// ─── Caret placement (regression: invisible/lost caret) ───────────────────────
//
// These assertions guard the MUTATION shape: the caret always ends on an
// ATTACHED TextNode at the end of the expansion (spliceText never empties the
// node, so nothing gets pruned). They run against a headless editor and drive
// the expansion algorithm directly, so they can NOT observe the real cause of
// the "invisible caret after Tab" report — that the KEY_TAB_COMMAND handler
// must call event.preventDefault() SYNCHRONOUSLY. Because Lexical defers the
// expand `editor.update` callback (KEY_TAB_COMMAND dispatches inside an active
// update), gating preventDefault on the callback let Tab's default focus
// traversal steal focus to the Send button, hiding the caret. The plugin now
// decides via a synchronous state read and preventDefaults up front; that
// ordering is verified in a real browser, not here.

/** Reads the collapsed selection anchor after an expansion. */
function anchorAfterExpand(editor: ReturnType<typeof buildEditor>): {
  isText: boolean
  attached: boolean
  atEnd: boolean
} {
  let out = { isText: false, attached: false, atEnd: false }
  editor.getEditorState().read(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const node = sel.anchor.getNode()
    const isText = $isTextNode(node)
    out = {
      isText,
      attached: node.isAttached(),
      atEnd: isText && sel.anchor.offset === node.getTextContent().length,
    }
  })
  return out
}

const CARET_SNIPPETS: readonly TextSnippet[] = [
  snippet("pgm", "pull request green then merge"),
  snippet("sig", "Best regards,\nAda"),
  snippet("lead", "\nsecond line"),
  snippet("trail", "line then newline\n"),
  snippet("gap", "a\n\nb"),
]

describe("SnippetExpandPlugin — caret placement", () => {
  it("lands the caret at the end of the expansion when the token is the whole node", () => {
    const editor = buildEditor()
    seedText(editor, "pgm")
    expect(expandInEditor(editor, CARET_SNIPPETS)).toBe(true)
    const a = anchorAfterExpand(editor)
    expect(a.isText).toBe(true)
    expect(a.attached).toBe(true)
    expect(a.atEnd).toBe(true)
  })

  it("lands the caret on an attached node for multi-line expansions", () => {
    const editor = buildEditor()
    seedText(editor, "please sig")
    expect(expandInEditor(editor, CARET_SNIPPETS)).toBe(true)
    expect(serializeEditorToWire(editor).text).toBe("please Best regards,\nAda")
    const a = anchorAfterExpand(editor)
    expect(a.isText).toBe(true)
    expect(a.attached).toBe(true)
    expect(a.atEnd).toBe(true)
  })

  it("handles an expansion that starts with a newline (leading empty line)", () => {
    const editor = buildEditor()
    seedText(editor, "lead")
    expect(expandInEditor(editor, CARET_SNIPPETS)).toBe(true)
    expect(serializeEditorToWire(editor).text).toBe("\nsecond line")
    const a = anchorAfterExpand(editor)
    expect(a.isText).toBe(true)
    expect(a.attached).toBe(true)
    expect(a.atEnd).toBe(true)
  })

  it("handles an expansion that ends with a newline (caret on the fresh line)", () => {
    const editor = buildEditor()
    seedText(editor, "trail")
    expect(expandInEditor(editor, CARET_SNIPPETS)).toBe(true)
    // The wire serializer trims a trailing soft line break, so the sent text is
    // the first line; the caret still sits on the fresh line, node attached.
    expect(serializeEditorToWire(editor).text).toBe("line then newline")
    expect(anchorAfterExpand(editor).attached).toBe(true)
  })

  it("handles consecutive newlines inside an expansion", () => {
    const editor = buildEditor()
    seedText(editor, "gap")
    expect(expandInEditor(editor, CARET_SNIPPETS)).toBe(true)
    expect(serializeEditorToWire(editor).text).toBe("a\n\nb")
    const a = anchorAfterExpand(editor)
    expect(a.isText).toBe(true)
    expect(a.attached).toBe(true)
    expect(a.atEnd).toBe(true)
  })
})
