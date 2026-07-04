import { beforeEach, describe, expect, test } from "bun:test"
import { useChatInputStore } from "./chatInputStore"
import type { SerializedEditorState } from "lexical"

// ---------------------------------------------------------------------------
// Helper: a minimal SerializedEditorState fixture
// ---------------------------------------------------------------------------

function makeLexicalState(text: string): SerializedEditorState {
  return {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
              type: "text",
              version: 1,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  } as unknown as SerializedEditorState
}

describe("chatInputStore", () => {
  beforeEach(() => {
    useChatInputStore.setState({
      drafts: {},
      attachmentDrafts: {},
    })
  })

  // ── Attachment drafts (unchanged behaviour) ────────────────────────────────

  test("stores attachment drafts per chat", () => {
    useChatInputStore.getState().setAttachmentDrafts("chat-1", [
      {
        id: "attachment-1",
        kind: "image",
        displayName: "mock.png",
        absolutePath: "/tmp/project/.kanna/uploads/mock.png",
        relativePath: "./.kanna/uploads/mock.png",
        contentUrl: "/api/projects/project-1/uploads/mock.png/content",
        mimeType: "image/png",
        size: 512,
      },
    ])

    expect(useChatInputStore.getState().getAttachmentDrafts("chat-1")).toHaveLength(1)
    expect(useChatInputStore.getState().getAttachmentDrafts("chat-2")).toEqual([])
  })

  test("clears attachment drafts for a chat", () => {
    useChatInputStore.getState().setAttachmentDrafts("chat-1", [
      {
        id: "attachment-1",
        kind: "file",
        displayName: "spec.pdf",
        absolutePath: "/tmp/project/.kanna/uploads/spec.pdf",
        relativePath: "./.kanna/uploads/spec.pdf",
        contentUrl: "/api/projects/project-1/uploads/spec.pdf/content",
        mimeType: "application/pdf",
        size: 1234,
      },
    ])

    useChatInputStore.getState().clearAttachmentDrafts("chat-1")
    expect(useChatInputStore.getState().getAttachmentDrafts("chat-1")).toEqual([])
  })

  // ── Text draft (new DraftEntry shape) ──────────────────────────────────────

  test("getDraft returns null when no draft exists", () => {
    expect(useChatInputStore.getState().getDraft("chat-no-draft")).toBeNull()
  })

  test("setDraft with a plain string stores a DraftEntry with text", () => {
    useChatInputStore.getState().setDraft("chat-1", "hello world")
    const draft = useChatInputStore.getState().getDraft("chat-1")
    expect(draft).not.toBeNull()
    expect(draft?.text).toBe("hello world")
    expect(draft?.lexicalState).toBeUndefined()
  })

  test("setDraft with an empty string removes the draft", () => {
    useChatInputStore.getState().setDraft("chat-1", "some text")
    useChatInputStore.getState().setDraft("chat-1", "")
    expect(useChatInputStore.getState().getDraft("chat-1")).toBeNull()
  })

  test("setDraft with SerializedEditorState stores lexicalState + text", () => {
    const state = makeLexicalState("Hello Lexical")
    useChatInputStore.getState().setDraft("chat-1", state, "Hello Lexical")

    const draft = useChatInputStore.getState().getDraft("chat-1")
    expect(draft).not.toBeNull()
    expect(draft?.text).toBe("Hello Lexical")
    expect(draft?.lexicalState).toBe(state)
  })

  test("clearDraft removes the stored draft", () => {
    useChatInputStore.getState().setDraft("chat-1", "some text")
    useChatInputStore.getState().clearDraft("chat-1")
    expect(useChatInputStore.getState().getDraft("chat-1")).toBeNull()
  })

  test("getDraft on a different chatId returns null (drafts are isolated)", () => {
    useChatInputStore.getState().setDraft("chat-1", "draft for chat 1")
    expect(useChatInputStore.getState().getDraft("chat-2")).toBeNull()
  })

  // ── Back-compat: legacy persisted string drafts hydrate correctly ──────────

  test("legacy string draft (from localStorage) is normalized to { text } by getDraft", () => {
    // Simulate a legacy persisted value (plain string in the drafts map)
    useChatInputStore.setState({
      drafts: { "legacy-chat": "legacy plain text" as unknown as import("./chatInputStore").DraftEntry },
    })

    const draft = useChatInputStore.getState().getDraft("legacy-chat")
    expect(draft).not.toBeNull()
    expect(draft?.text).toBe("legacy plain text")
    expect(draft?.lexicalState).toBeUndefined()
  })

  test("legacy empty string draft normalizes to null", () => {
    useChatInputStore.setState({
      drafts: { "legacy-chat": "" as unknown as import("./chatInputStore").DraftEntry },
    })

    expect(useChatInputStore.getState().getDraft("legacy-chat")).toBeNull()
  })
})
