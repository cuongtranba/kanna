import { describe, expect, it, mock } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import { AttachmentNode, $getAttachmentNodes } from "../nodes"
import { INLINE_UPLOAD_LIMITS, uploadFilesIntoEditor, type UploadFileFn } from "./inlineUploads"


const fakeAttachment: ChatAttachment = {
  id: "drop-att-1",
  kind: "file",
  displayName: "document.pdf",
  absolutePath: "/tmp/uploads/document.pdf",
  relativePath: "document.pdf",
  contentUrl: "https://example.com/document.pdf",
  mimeType: "application/pdf",
  size: 4096,
}


function buildEditor() {
  const editor = createHeadlessEditor({
    namespace: "test",
    nodes: [AttachmentNode],
    onError: (e: Error) => {
      throw e
    },
  })
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode())
    },
    { discrete: true },
  )
  return editor
}


function makeUploadFileMock(attachment: ChatAttachment = fakeAttachment): UploadFileFn {
  return mock(() => ({
    promise: Promise.resolve({ attachments: [attachment] }),
    abort: () => {},
  })) as unknown as UploadFileFn
}


describe("uploadFilesIntoEditor", () => {
  it("uploads a single file and inserts an AttachmentNode", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    const file = new File(["content"], "report.pdf", { type: "application/pdf" })

    await uploadFilesIntoEditor([file], editor, "chat-1", mockUpload)

    let nodeCount = 0
    editor.read(() => {
      nodeCount = $getAttachmentNodes().length
    })
    expect(nodeCount).toBe(1)
  })

  it("inserts one AttachmentNode per uploaded file", async () => {
    const editor = buildEditor()
    const files = [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]

    let callIndex = 0
    const attachments: ChatAttachment[] = [
      { ...fakeAttachment, id: "drop-a" },
      { ...fakeAttachment, id: "drop-b" },
    ]
    const mockUpload = mock(() => {
      const att = attachments[callIndex++]!
      return { promise: Promise.resolve({ attachments: [att] }), abort: () => {} }
    }) as unknown as UploadFileFn

    await uploadFilesIntoEditor(files, editor, "chat-1", mockUpload)

    let ids: string[] = []
    editor.read(() => {
      ids = $getAttachmentNodes().map((n) => n.getAttachment().id)
    })
    expect(ids).toHaveLength(2)
    expect(ids).toContain("drop-a")
    expect(ids).toContain("drop-b")
  })

  it("handles image files too (not just documents)", async () => {
    const editor = buildEditor()
    const imageAttachment: ChatAttachment = {
      ...fakeAttachment,
      id: "img-drop",
      kind: "image",
      mimeType: "image/png",
    }
    const mockUpload = makeUploadFileMock(imageAttachment)
    const file = new File(["img"], "photo.png", { type: "image/png" })

    await uploadFilesIntoEditor([file], editor, "chat-1", mockUpload)

    let attachment: ChatAttachment | null = null
    editor.read(() => {
      const nodes = $getAttachmentNodes()
      if (nodes.length > 0) attachment = nodes[0]!.getAttachment()
    })
    expect(attachment).not.toBeNull()
    expect((attachment as ChatAttachment | null)?.kind).toBe("image")
  })

  it("calls onUploadError when upload returns no attachment", async () => {
    const editor = buildEditor()
    const mockUpload = mock(() => ({
      promise: Promise.resolve({ attachments: [] }),
      abort: () => {},
    })) as unknown as UploadFileFn

    const errors: string[] = []
    const file = new File(["x"], "x.pdf", { type: "application/pdf" })
    await uploadFilesIntoEditor([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

    expect(errors).toHaveLength(1)
    let nodeCount = 0
    editor.read(() => {
      nodeCount = $getAttachmentNodes().length
    })
    expect(nodeCount).toBe(0)
  })

  it("calls onUploadError when upload rejects", async () => {
    const editor = buildEditor()
    const mockUpload = mock(() => ({
      promise: Promise.reject(new Error("drop upload failed")),
      abort: () => {},
    })) as unknown as UploadFileFn

    const errors: string[] = []
    const file = new File(["x"], "x.pdf", { type: "application/pdf" })
    await uploadFilesIntoEditor([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

    expect(errors[0]).toContain("drop upload failed")
  })

  it("does nothing when files array is empty", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    await uploadFilesIntoEditor([], editor, "chat-1", mockUpload)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("does nothing when files exceed INLINE_UPLOAD_LIMITS.maxFiles", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    const files = Array.from({ length: INLINE_UPLOAD_LIMITS.maxFiles + 1 }, (_, i) =>
      new File(["x"], `file-${i}.pdf`, { type: "application/pdf" }),
    )
    await uploadFilesIntoEditor(files, editor, "chat-1", mockUpload)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("respects INLINE_UPLOAD_LIMITS.maxConcurrent concurrency limit", async () => {
    const editor = buildEditor()
    let maxConcurrent = 0
    let current = 0

    const mockUpload = mock(() => ({
      promise: new Promise<{ attachments: ChatAttachment[] }>((resolve) => {
        current++
        if (current > maxConcurrent) maxConcurrent = current
        Promise.resolve().then(() => {
          current--
          resolve({ attachments: [fakeAttachment] })
        })
      }),
      abort: () => {},
    })) as unknown as UploadFileFn

    const files = Array.from({ length: INLINE_UPLOAD_LIMITS.maxConcurrent + 2 }, (_, i) =>
      new File(["x"], `f-${i}.pdf`, { type: "application/pdf" }),
    )
    await uploadFilesIntoEditor(files, editor, "chat-1", mockUpload)
    expect(maxConcurrent).toBeLessThanOrEqual(INLINE_UPLOAD_LIMITS.maxConcurrent)
  })

  it("silently ignores UploadAbortedError", async () => {
    const editor = buildEditor()
    const abortErr = new Error("Upload aborted")
    abortErr.name = "UploadAbortedError"
    const mockUpload = mock(() => ({
      promise: Promise.reject(abortErr),
      abort: () => {},
    })) as unknown as UploadFileFn

    const errors: string[] = []
    const file = new File(["x"], "x.pdf", { type: "application/pdf" })
    await uploadFilesIntoEditor([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

    expect(errors).toHaveLength(0)
  })
})
