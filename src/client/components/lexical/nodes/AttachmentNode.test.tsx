import { describe, expect, it } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import {
  AttachmentNode,
  $createAttachmentNode,
  $isAttachmentNode,
  $getAttachmentNodes,
  type SerializedAttachmentNode,
} from "./AttachmentNode"

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

// ─── Editor factory ──────────────────────────────────────────────────────────

function buildEditor() {
  return createHeadlessEditor({
    namespace: "test",
    nodes: [AttachmentNode],
    onError: (e: Error) => {
      throw e
    },
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AttachmentNode", () => {
  it("getType() returns 'kanna-attachment'", () => {
    expect(AttachmentNode.getType()).toBe("kanna-attachment")
  })

  it("isInline() returns true", () => {
    const editor = buildEditor()
    let result = false
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createAttachmentNode(fakeImageAttachment)
        para.append(node)
        root.append(para)
        result = node.isInline()
      },
      { discrete: true },
    )
    expect(result).toBe(true)
  })

  it("isKeyboardSelectable() returns true", () => {
    const editor = buildEditor()
    let result = false
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createAttachmentNode(fakeFileAttachment)
        para.append(node)
        root.append(para)
        result = node.isKeyboardSelectable()
      },
      { discrete: true },
    )
    expect(result).toBe(true)
  })

  it("getTextContent() returns empty string", () => {
    const editor = buildEditor()
    let textContent = "UNSET"

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createAttachmentNode(fakeImageAttachment)
        para.append(node)
        root.append(para)
        textContent = node.getTextContent()
      },
      { discrete: true },
    )

    expect(textContent).toBe("")
  })

  it("$isAttachmentNode() returns true for AttachmentNode", () => {
    const editor = buildEditor()
    let result = false

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createAttachmentNode(fakeImageAttachment)
        para.append(node)
        root.append(para)
        result = $isAttachmentNode(node)
      },
      { discrete: true },
    )

    expect(result).toBe(true)
  })

  it("getAttachment() returns the original ChatAttachment", () => {
    const editor = buildEditor()
    let retrieved: ChatAttachment | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createAttachmentNode(fakeFileAttachment)
        para.append(node)
        root.append(para)
        retrieved = node.getAttachment()
      },
      { discrete: true },
    )

    expect(retrieved as ChatAttachment | null).toEqual(fakeFileAttachment)
  })

  it("clone() preserves the attachment", () => {
    const editor = buildEditor()
    let attachment: ReturnType<AttachmentNode["getAttachment"]> | null = null
    let isInstance = false
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const original = $createAttachmentNode(fakeImageAttachment)
        para.append(original)
        root.append(para)
        const cloned = AttachmentNode.clone(original)
        attachment = cloned.getAttachment()
        isInstance = cloned instanceof AttachmentNode
      },
      { discrete: true },
    )
    expect(attachment as ChatAttachment | null).toEqual(fakeImageAttachment)
    expect(isInstance).toBe(true)
  })

  it("exportJSON / importJSON round-trip preserves the attachment", () => {
    const editor = buildEditor()
    let serialized: SerializedAttachmentNode | null = null
    let roundTripped: SerializedAttachmentNode | null = null

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        const node = $createAttachmentNode(fakeImageAttachment)
        para.append(node)
        root.append(para)
        serialized = node.exportJSON() as SerializedAttachmentNode
        const restored = AttachmentNode.importJSON(
          serialized as SerializedAttachmentNode,
        )
        roundTripped = restored.exportJSON() as SerializedAttachmentNode
      },
      { discrete: true },
    )

    expect(serialized).not.toBeNull()
    expect(serialized!.type).toBe("kanna-attachment")
    expect(serialized!.version).toBe(1)
    expect(serialized!.attachment).toEqual(fakeImageAttachment)

    expect(roundTripped).not.toBeNull()
    expect(roundTripped!.attachment).toEqual(fakeImageAttachment)
  })

  it("$getAttachmentNodes() finds all AttachmentNodes in the editor", () => {
    const editor = buildEditor()
    let foundCount = 0
    let foundIds: string[] = []

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const para = $createParagraphNode()
        para.append($createAttachmentNode(fakeImageAttachment))
        para.append($createAttachmentNode(fakeFileAttachment))
        root.append(para)
        const nodes = $getAttachmentNodes()
        foundCount = nodes.length
        foundIds = nodes.map((n) => n.getAttachment().id)
      },
      { discrete: true },
    )

    expect(foundCount).toBe(2)
    expect(foundIds).toContain(fakeImageAttachment.id)
    expect(foundIds).toContain(fakeFileAttachment.id)
  })
})
