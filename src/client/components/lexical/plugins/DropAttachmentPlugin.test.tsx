import { describe, expect, it, mock } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import { AttachmentNode, $getAttachmentNodes } from "../nodes"
import {
  getDroppedFiles,
  uploadDroppedFiles,
  MAX_FILES_PER_DROP,
  MAX_CONCURRENT_DROP_UPLOADS,
  type UploadFileFn,
} from "./DropAttachmentPlugin"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── Editor factory ────────────────────────────────────────────────────────────

function buildEditor() {
  const editor = createHeadlessEditor({
    namespace: "test",
    nodes: [AttachmentNode],
    onError: (e: Error) => {
      throw e
    },
  })
  // Seed a paragraph so $insertNodes has a selection context
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

// ─── Mock uploadFile factory ──────────────────────────────────────────────────

function makeUploadFileMock(attachment: ChatAttachment = fakeAttachment): UploadFileFn {
  return mock(() => ({
    promise: Promise.resolve({ attachments: [attachment] }),
    abort: () => {},
  })) as unknown as UploadFileFn
}

// ─── Helper: build a minimal DragEvent-like object ──────────────────────────

function makeDragEvent(files: File[]): DragEvent {
  // Build an array-like DataTransferItemList with integer-indexed items
  const itemObjs = files.map((file) => ({
    kind: "file" as const,
    type: file.type,
    getAsFile: () => file,
  }))

  const itemsList: Record<string | number, unknown> = { length: itemObjs.length }
  for (let i = 0; i < itemObjs.length; i++) {
    itemsList[i] = itemObjs[i]
  }

  return {
    dataTransfer: {
      items: itemsList,
      files: null,
    },
    preventDefault: () => {},
  } as unknown as DragEvent
}

// ─── Tests: getDroppedFiles ────────────────────────────────────────────────────

describe("getDroppedFiles", () => {
  it("extracts files from dataTransfer.items", () => {
    const file = new File(["data"], "test.pdf", { type: "application/pdf" })
    const event = makeDragEvent([file])
    const result = getDroppedFiles(event)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("test.pdf")
  })

  it("returns empty array when no files in drop", () => {
    const event = {
      dataTransfer: {
        items: { length: 0 },
        files: null,
      },
      preventDefault: () => {},
    } as unknown as DragEvent
    expect(getDroppedFiles(event)).toHaveLength(0)
  })

  it("returns empty array when dataTransfer is null", () => {
    const event = { dataTransfer: null, preventDefault: () => {} } as unknown as DragEvent
    expect(getDroppedFiles(event)).toHaveLength(0)
  })

  it("extracts multiple files from drop", () => {
    const files = [
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
      new File(["c"], "c.png", { type: "image/png" }),
    ]
    const event = makeDragEvent(files)
    const result = getDroppedFiles(event)
    expect(result).toHaveLength(3)
    expect(result.map((f) => f.name)).toContain("a.txt")
    expect(result.map((f) => f.name)).toContain("b.pdf")
    expect(result.map((f) => f.name)).toContain("c.png")
  })

  it("falls back to dataTransfer.files when items is absent", () => {
    const file = new File(["x"], "fallback.txt", { type: "text/plain" })
    // Build a mock FileList-like object
    const fileList = {
      length: 1,
      0: file,
    }
    const event = {
      dataTransfer: {
        items: undefined,
        files: fileList,
      },
      preventDefault: () => {},
    } as unknown as DragEvent
    const result = getDroppedFiles(event)
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("fallback.txt")
  })
})

// ─── Tests: uploadDroppedFiles ─────────────────────────────────────────────────

describe("uploadDroppedFiles", () => {
  it("uploads a single file and inserts an AttachmentNode", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    const file = new File(["content"], "report.pdf", { type: "application/pdf" })

    await uploadDroppedFiles([file], editor, "chat-1", mockUpload)

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

    await uploadDroppedFiles(files, editor, "chat-1", mockUpload)

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

    await uploadDroppedFiles([file], editor, "chat-1", mockUpload)

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
    await uploadDroppedFiles([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

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
    await uploadDroppedFiles([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

    expect(errors[0]).toContain("drop upload failed")
  })

  it("does nothing when files array is empty", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    await uploadDroppedFiles([], editor, "chat-1", mockUpload)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("does nothing when files exceed MAX_FILES_PER_DROP", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    const files = Array.from({ length: MAX_FILES_PER_DROP + 1 }, (_, i) =>
      new File(["x"], `file-${i}.pdf`, { type: "application/pdf" }),
    )
    await uploadDroppedFiles(files, editor, "chat-1", mockUpload)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("respects MAX_CONCURRENT_DROP_UPLOADS concurrency limit", async () => {
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

    const files = Array.from({ length: MAX_CONCURRENT_DROP_UPLOADS + 2 }, (_, i) =>
      new File(["x"], `f-${i}.pdf`, { type: "application/pdf" }),
    )
    await uploadDroppedFiles(files, editor, "chat-1", mockUpload)
    expect(maxConcurrent).toBeLessThanOrEqual(MAX_CONCURRENT_DROP_UPLOADS)
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
    await uploadDroppedFiles([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

    expect(errors).toHaveLength(0)
  })
})
