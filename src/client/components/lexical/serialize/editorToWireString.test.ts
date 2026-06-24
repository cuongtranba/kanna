import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot, $createTextNode } from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import {
  MentionNode,
  SlashCommandNode,
  AttachmentNode,
  KANNA_COMPOSER_NODES,
  $createMentionNode,
  $createSlashCommandNode,
  $createAttachmentNode,
} from "../nodes"
import { serializeEditorToWire } from "./editorToWireString"

// ─── Editor factory ──────────────────────────────────────────────────────────

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [...KANNA_COMPOSER_NODES],
    onError: (e: Error) => {
      throw e
    },
  })
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakeImageAttachment: ChatAttachment = {
  id: "att-img-1",
  kind: "image",
  displayName: "screenshot.png",
  absolutePath: "/tmp/screenshot.png",
  relativePath: "screenshot.png",
  contentUrl: "blob:http://localhost/abc-123",
  mimeType: "image/png",
  size: 204_800,
}

const fakeFileAttachment: ChatAttachment = {
  id: "att-file-1",
  kind: "file",
  displayName: "report.pdf",
  absolutePath: "/tmp/report.pdf",
  relativePath: "report.pdf",
  contentUrl: "",
  mimeType: "application/pdf",
  size: 1_048_576,
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("serializeEditorToWire — plain text", () => {
  it("returns the plain text and empty attachments for a simple paragraph", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello world"))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("hello world")
    expect(result.attachments).toHaveLength(0)
  })

  it("returns empty text for an empty editor", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("")
    expect(result.attachments).toHaveLength(0)
  })
})

describe("serializeEditorToWire — MentionNode (agent)", () => {
  it("serializes agent mention to @agent/<value>", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "foo", label: "foo" }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("@agent/foo")
    expect(result.attachments).toHaveLength(0)
  })

  it("serializes mixed text + agent mention correctly", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hey "))
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "foo", label: "Foo" }),
        )
        para.append($createTextNode(" do this"))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("hey @agent/foo do this")
  })
})

describe("serializeEditorToWire — MentionNode (path)", () => {
  it("serializes path mention to @<path>", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append(
          $createMentionNode({ mentionKind: "path", value: "./src/x.ts", label: "x.ts" }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("@./src/x.ts")
    expect(result.attachments).toHaveLength(0)
  })
})

describe("serializeEditorToWire — SlashCommandNode", () => {
  it("serializes slash command without argument to /<name>", () => {
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

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("/clear")
    expect(result.attachments).toHaveLength(0)
  })

  it("serializes slash command with argument to /<name> (trailing space)", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append(
          $createSlashCommandNode({ commandName: "model", hasArgument: true }),
        )
        para.append($createTextNode("claude-opus-4-5"))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("/model claude-opus-4-5")
  })
})

describe("serializeEditorToWire — AttachmentNode", () => {
  it("excludes attachment from text and returns it in attachments[]", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createAttachmentNode(fakeImageAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toEqual(fakeImageAttachment)
  })

  it("collects multiple attachments and preserves order", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createAttachmentNode(fakeImageAttachment))
        para.append($createAttachmentNode(fakeFileAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("")
    expect(result.attachments).toHaveLength(2)
    expect(result.attachments[0]).toEqual(fakeImageAttachment)
    expect(result.attachments[1]).toEqual(fakeFileAttachment)
  })
})

describe("serializeEditorToWire — mixed content", () => {
  it("serializes text + agent mention + slash command in one paragraph", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello "))
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "foo", label: "foo" }),
        )
        para.append($createTextNode(" "))
        para.append(
          $createSlashCommandNode({ commandName: "clear", hasArgument: false }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("hello @agent/foo /clear")
    expect(result.attachments).toHaveLength(0)
  })

  it("serializes text + attachment: text in wire, attachment in array", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("see attached"))
        para.append($createAttachmentNode(fakeImageAttachment))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("see attached")
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toEqual(fakeImageAttachment)
  })

  it("trims trailing whitespace from the wire string", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello   "))
        root.append(para)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("hello")
  })

  it("joins multiple paragraphs with a newline", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para1 = $createParagraphNode()
        para1.append($createTextNode("line one"))
        const para2 = $createParagraphNode()
        para2.append($createTextNode("line two"))
        root.append(para1)
        root.append(para2)
      },
      { discrete: true },
    )

    const result = serializeEditorToWire(editor)
    expect(result.text).toBe("line one\nline two")
  })
})

describe("serializeEditorToWire — exact legacy string", () => {
  it("reproduces the wire string: 'hello @agent/foo /clear'", () => {
    const editor = buildEditor()
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createTextNode("hello "))
        para.append(
          $createMentionNode({ mentionKind: "agent", value: "foo", label: "foo" }),
        )
        para.append($createTextNode(" "))
        para.append(
          $createSlashCommandNode({ commandName: "clear", hasArgument: false }),
        )
        root.append(para)
      },
      { discrete: true },
    )

    const { text, attachments } = serializeEditorToWire(editor)
    expect(text).toBe("hello @agent/foo /clear")
    expect(attachments).toHaveLength(0)
  })
})

// Ensure we're using all three node types from KANNA_COMPOSER_NODES
describe("serializeEditorToWire — KANNA_COMPOSER_NODES coverage", () => {
  it("includes MentionNode, SlashCommandNode, and AttachmentNode", () => {
    expect(KANNA_COMPOSER_NODES).toContain(MentionNode)
    expect(KANNA_COMPOSER_NODES).toContain(SlashCommandNode)
    expect(KANNA_COMPOSER_NODES).toContain(AttachmentNode)
  })
})
