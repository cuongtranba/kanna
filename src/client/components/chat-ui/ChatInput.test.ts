import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PROVIDERS } from "../../../shared/types"
import { createAgentMentionRegex } from "../../../shared/mention-pattern"
import {
  ChatInput,
  getClipboardImageFiles,
  trimTrailingPastedNewlines,
  willExceedAttachmentLimit,
  isTouchDeviceEnvironment,
  shouldRefreshPickerOnSelection,
} from "./ChatInput"

// ---------------------------------------------------------------------------
// Clipboard item test helper
// ---------------------------------------------------------------------------

function createClipboardItem(args: {
  kind?: string
  type: string
  file?: File | null
}) {
  return {
    kind: args.kind ?? "file",
    type: args.type,
    getAsFile: () => args.file ?? null,
  }
}

// ---------------------------------------------------------------------------
// willExceedAttachmentLimit
// ---------------------------------------------------------------------------

describe("willExceedAttachmentLimit", () => {
  test("rejects a batch that would push the composer above the total attachment limit", () => {
    expect(
      willExceedAttachmentLimit({
        currentAttachmentCount: 45,
        queuedAttachmentCount: 3,
        incomingAttachmentCount: 3,
      }),
    ).toBe(true)
  })

  test("allows a batch that exactly reaches the total attachment limit", () => {
    expect(
      willExceedAttachmentLimit({
        currentAttachmentCount: 45,
        queuedAttachmentCount: 3,
        incomingAttachmentCount: 2,
      }),
    ).toBe(false)
  })

  test("counts pasted files against the same total attachment limit", () => {
    const pastedFiles = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/png",
          file: new File(["a"], "", { type: "image/png" }),
        }),
        createClipboardItem({
          type: "image/png",
          file: new File(["b"], "", { type: "image/png" }),
        }),
      ],
      123,
    )

    expect(
      willExceedAttachmentLimit({
        currentAttachmentCount: 48,
        queuedAttachmentCount: 0,
        incomingAttachmentCount: pastedFiles.length,
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getClipboardImageFiles
// ---------------------------------------------------------------------------

describe("getClipboardImageFiles", () => {
  test("returns image files from clipboard items", () => {
    const files = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/png",
          file: new File(["img"], "pasted.png", { type: "image/png" }),
        }),
      ],
      123,
    )

    expect(files).toHaveLength(1)
    expect(files[0]?.name).toBe("pasted.png")
  })

  test("ignores non-image clipboard items", () => {
    const files = getClipboardImageFiles(
      [
        createClipboardItem({ kind: "string", type: "text/plain" }),
        createClipboardItem({
          type: "application/pdf",
          file: new File(["pdf"], "doc.pdf", { type: "application/pdf" }),
        }),
      ],
      123,
    )

    expect(files).toEqual([])
  })

  test("renames unnamed pasted images using the clipboard timestamp", () => {
    const files = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/png",
          file: new File(["img"], "", { type: "image/png" }),
        }),
      ],
      456,
    )

    expect(files[0]?.name).toBe("clipboard-456.png")
  })

  test("preserves existing filenames from the browser", () => {
    const files = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/jpeg",
          file: new File(["img"], "Screenshot 1.jpg", { type: "image/jpeg" }),
        }),
      ],
      456,
    )

    expect(files[0]?.name).toBe("Screenshot 1.jpg")
  })

  test("rewrites generic browser clipboard filenames", () => {
    const files = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/png",
          file: new File(["img"], "image.png", { type: "image/png" }),
        }),
      ],
      456,
    )

    expect(files[0]?.name).toBe("clipboard-456.png")
  })

  test("generates distinct names for multiple unnamed images in one paste event", () => {
    const files = getClipboardImageFiles(
      [
        createClipboardItem({
          type: "image/png",
          file: new File(["a"], "", { type: "image/png" }),
        }),
        createClipboardItem({
          type: "image/webp",
          file: new File(["b"], "", { type: "image/webp" }),
        }),
      ],
      789,
    )

    expect(files.map((file) => file.name)).toEqual(["clipboard-789.png", "clipboard-789-1.webp"])
  })
})

// ---------------------------------------------------------------------------
// trimTrailingPastedNewlines
// ---------------------------------------------------------------------------

describe("trimTrailingPastedNewlines", () => {
  test("removes trailing unix newlines from pasted text", () => {
    expect(trimTrailingPastedNewlines("hello\n\n")).toBe("hello")
  })

  test("removes trailing windows newlines from pasted text", () => {
    expect(trimTrailingPastedNewlines("hello\r\n\r\n")).toBe("hello")
  })

  test("preserves internal newlines", () => {
    expect(trimTrailingPastedNewlines("hello\nworld\n")).toBe("hello\nworld")
  })

  test("leaves text without trailing newlines unchanged", () => {
    expect(trimTrailingPastedNewlines("hello")).toBe("hello")
  })
})

// ---------------------------------------------------------------------------
// Touch-device helpers (still exported from ChatInput)
// ---------------------------------------------------------------------------

describe("isTouchDeviceEnvironment", () => {
  test("returns a boolean", () => {
    // In the test environment (Node/Bun), window may not have ontouchstart
    expect(typeof isTouchDeviceEnvironment()).toBe("boolean")
  })
})

describe("shouldRefreshPickerOnSelection", () => {
  test("desktop -> returns true (refresh picker on caret moves)", () => {
    expect(shouldRefreshPickerOnSelection(false)).toBe(true)
  })

  test("touch device -> returns false (no picker refresh to avoid iOS caret jump)", () => {
    expect(shouldRefreshPickerOnSelection(true)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ChatInput component (SSR smoke test)
// ---------------------------------------------------------------------------

describe("ChatInput", () => {
  test("renders the attachment trigger as a button with a sibling hidden file input", () => {
    const html = renderToStaticMarkup(
      createElement(ChatInput, {
        onSubmit: async () => undefined,
        disabled: false,
        canCancel: false,
        activeProvider: null,
        availableProviders: PROVIDERS,
      }),
    )

    expect(html).toContain('aria-label="Add attachment"')
    expect(html).toContain('type="file"')
    expect(html).toContain('class="sr-only"')
    // Verify the old "absolute inset-0" hack is gone
    expect(html).not.toContain("absolute inset-0 cursor-pointer opacity-0")
  })

  test("renders the Lexical contenteditable editor (not a textarea)", () => {
    const html = renderToStaticMarkup(
      createElement(ChatInput, {
        onSubmit: async () => undefined,
        disabled: false,
        canCancel: false,
        activeProvider: null,
        availableProviders: PROVIDERS,
      }),
    )

    // Lexical renders a contenteditable div, not a textarea
    expect(html).toContain("contentEditable")
    expect(html).toContain('aria-label="Chat input"')
    expect(html).toContain('role="textbox"')
  })

  test("renders the placeholder text", () => {
    const html = renderToStaticMarkup(
      createElement(ChatInput, {
        onSubmit: async () => undefined,
        disabled: false,
        canCancel: false,
        activeProvider: null,
        availableProviders: PROVIDERS,
      }),
    )

    expect(html).toContain("Build something...")
  })

  test("renders send button with correct aria-label when canCancel=false", () => {
    const html = renderToStaticMarkup(
      createElement(ChatInput, {
        onSubmit: async () => undefined,
        disabled: false,
        canCancel: false,
        activeProvider: null,
        availableProviders: PROVIDERS,
      }),
    )

    expect(html).toContain('aria-label="Send message"')
  })

  test("renders stop button with correct aria-label when canCancel=true", () => {
    const html = renderToStaticMarkup(
      createElement(ChatInput, {
        onSubmit: async () => undefined,
        disabled: false,
        canCancel: true,
        activeProvider: null,
        availableProviders: PROVIDERS,
      }),
    )

    expect(html).toContain('aria-label="Stop"')
  })
})

// ---------------------------------------------------------------------------
// Mention picker wiring (unchanged — tests the lib, not the component)
// ---------------------------------------------------------------------------

describe("mention picker wiring", () => {
  test("shouldShowMentionPicker trigger produces the expected shape for mid-input @", async () => {
    const { shouldShowMentionPicker } = await import("../../lib/mention-suggestions")
    expect(shouldShowMentionPicker("hello @src", 10)).toEqual({
      open: true,
      query: "src",
      tokenStart: 6,
    })
  })
})

// ---------------------------------------------------------------------------
// Agent mention pattern composer compatibility
// ---------------------------------------------------------------------------

describe("agent mention pattern composer compatibility", () => {
  test("plain text contains no agent mentions", () => {
    const matches = Array.from("hello world".matchAll(createAgentMentionRegex()))
    expect(matches).toHaveLength(0)
  })

  test("@agent/<name> in text matches the shared pattern", () => {
    const matches = Array.from(
      "hi @agent/alpha please review".matchAll(createAgentMentionRegex()),
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]?.[2]).toBe("alpha")
  })

  test("multiple @agent/<name> mentions all detected", () => {
    const matches = Array.from("@agent/alpha @agent/beta".matchAll(createAgentMentionRegex()))
    expect(matches.map((m) => m[2])).toEqual(["alpha", "beta"])
  })

  test("@agent/<name> without leading whitespace at start of string matches", () => {
    const matches = Array.from("@agent/alpha".matchAll(createAgentMentionRegex()))
    expect(matches).toHaveLength(1)
  })

  test("@agent/<name> inline mid-word does NOT match (server gate parity)", () => {
    const matches = Array.from("foo@agent/alpha".matchAll(createAgentMentionRegex()))
    expect(matches).toHaveLength(0)
  })
})
