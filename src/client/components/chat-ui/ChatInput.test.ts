import { describe, expect, test } from "bun:test"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import "../../lib/testing/setupHappyDom"
import { PROVIDERS } from "../../../shared/types"
import { ChatTabScopedStore } from "../../stores/chatTabScopedStore"
import { useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { createAgentMentionRegex } from "../../../shared/mention-pattern"
import {
  ChatInput,
  getClipboardImageFiles,
  trimTrailingPastedNewlines,
  willExceedAttachmentLimit,
  isTouchDeviceEnvironment,
  isStopAffordance,
  shouldRefreshPickerOnSelection,
} from "./ChatInput"


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


describe("isTouchDeviceEnvironment", () => {
  test("returns a boolean", () => {
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


describe("ChatInput", () => {
  function renderInput(canCancel: boolean): string {
    const child = createElement(ChatInput, {
      onSubmit: async () => undefined,
      disabled: false,
      canCancel,
      activeProvider: null,
      availableProviders: PROVIDERS,
    })
    return renderToStaticMarkup(
      createElement(ChatTabScopedStore.Provider, { init: undefined as void, children: child }),
    )
  }

  test("renders the attachment trigger as a button with a sibling hidden file input", () => {
    const html = renderInput(false)
    expect(html).toContain('aria-label="Add attachment"')
    expect(html).toContain('type="file"')
    expect(html).toContain('class="sr-only"')
    expect(html).not.toContain("absolute inset-0 cursor-pointer opacity-0")
  })

  test("renders the Lexical contenteditable editor (not a textarea)", () => {
    const html = renderInput(false)
    expect(html).toContain("contentEditable")
    expect(html).toContain('aria-label="Chat input"')
    expect(html).toContain('role="textbox"')
  })

  test("renders the placeholder text", () => {
    const html = renderInput(false)
    expect(html).toContain("Build something...")
    expect(html).not.toContain("Edit last message")
  })

  test("renders send button with correct aria-label when canCancel=false", () => {
    const html = renderInput(false)
    expect(html).toContain('aria-label="Send message"')
  })

  test("renders stop button with correct aria-label when canCancel=true", () => {
    const html = renderInput(true)
    expect(html).toContain('aria-label="Stop"')
  })

  test("shows the previous-message hint and restores it with ArrowUp", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    try {
      await act(async () => {
        root.render(
          createElement(
            ChatTabScopedStore.Provider,
            {
              init: undefined as void,
              children: createElement(ChatInput, {
                onSubmit: async () => undefined,
                disabled: false,
                canCancel: false,
                activeProvider: null,
                availableProviders: PROVIDERS,
                previousPrompt: "Restore the previous prompt",
              }),
            },
          ),
        )
      })

      const editor = container.querySelector('[role="textbox"]') as HTMLDivElement
      expect(container.textContent).toContain("Edit last message")

      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowUp",
      })
      await act(async () => {
        editor.dispatchEvent(event)
      })

      expect(event.defaultPrevented).toBe(true)
      expect(editor.textContent).toBe("Restore the previous prompt")
      expect(container.textContent).not.toContain("Edit last message")
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
    }
  })

  test("a provider re-picked away from the chat's runtime provider keeps that provider's model", async () => {
    const chatId = "chat-ran-on-codex"
    const store = useChatPreferencesStore.getState()
    store.initializeComposerForChat(chatId, { providerHint: "codex" })
    store.resetChatComposerFromProvider(chatId, "claude")
    const claudeModel = store.providerDefaults.claude.model
    const codexModel = store.providerDefaults.codex.model
    const labelOf = (provider: "claude" | "codex", id: string) =>
      PROVIDERS.find((entry) => entry.id === provider)?.models.find((model) => model.id === id)?.label ?? id

    const rendered = await renderClientMarkup(
      createElement(ChatTabScopedStore.Provider, {
        init: undefined as void,
        children: createElement(ChatInput, {
          onSubmit: async () => undefined,
          disabled: false,
          canCancel: false,
          chatId,
          activeProvider: "codex",
          availableProviders: PROVIDERS,
        }),
      }),
    )
    try {
      expect(rendered.html).toContain(labelOf("claude", claudeModel))
      expect(rendered.html).not.toContain(labelOf("codex", codexModel))
    } finally {
      await rendered.cleanup()
      useChatPreferencesStore.setState(useChatPreferencesStore.getInitialState())
    }
  })
})


describe("isStopAffordance", () => {
  test("is Stop only while a turn is cancellable and the composer is empty", () => {
    expect(isStopAffordance(true, false)).toBe(true)
  })

  test("is Send when text is staged, even mid-turn", () => {
    expect(isStopAffordance(true, true)).toBe(false)
  })

  test("is Send when no turn is cancellable", () => {
    expect(isStopAffordance(false, false)).toBe(false)
    expect(isStopAffordance(false, true)).toBe(false)
  })
})


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
