import { describe, expect, it, mock } from "bun:test"
import { createHeadlessEditor } from "@lexical/headless"
import { $createParagraphNode, $getRoot } from "lexical"
import type { ChatAttachment } from "../../../../shared/types"
import { AttachmentNode, $getAttachmentNodes } from "../nodes"
import {
  getClipboardImageFiles,
  normalizeClipboardImageFile,
  trimTrailingPastedNewlines,
  hasClipboardTextPayload,
  uploadAndInsertFiles,
  MAX_FILES_PER_PASTE,
  MAX_CONCURRENT_UPLOADS,
  type UploadFileFn,
} from "./PasteImagePlugin"

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const fakeAttachment: ChatAttachment = {
  id: "att-1",
  kind: "image",
  displayName: "clipboard-12345.png",
  absolutePath: "/tmp/uploads/att-1.png",
  relativePath: "att-1.png",
  contentUrl: "https://example.com/att-1.png",
  mimeType: "image/png",
  size: 1024,
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

// ─── Tests: clipboard helpers ─────────────────────────────────────────────────

describe("getClipboardImageFiles", () => {
  it("returns empty array when no image items", () => {
    const items: DataTransferItem[] = []
    expect(getClipboardImageFiles(items, Date.now())).toEqual([])
  })

  it("extracts image/png file items", () => {
    const fakeFile = new File(["data"], "image.png", { type: "image/png" })
    const item: Pick<DataTransferItem, "kind" | "type" | "getAsFile"> = {
      kind: "file",
      type: "image/png",
      getAsFile: () => fakeFile,
    }
    const result = getClipboardImageFiles([item], 12345)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe("image/png")
  })

  it("skips non-image file items", () => {
    const fakePdf = new File(["data"], "file.pdf", { type: "application/pdf" })
    const item: Pick<DataTransferItem, "kind" | "type" | "getAsFile"> = {
      kind: "file",
      type: "application/pdf",
      getAsFile: () => fakePdf,
    }
    expect(getClipboardImageFiles([item], Date.now())).toHaveLength(0)
  })

  it("skips string items (kind !== 'file')", () => {
    const item: Pick<DataTransferItem, "kind" | "type" | "getAsFile"> = {
      kind: "string",
      type: "text/plain",
      getAsFile: () => null,
    }
    expect(getClipboardImageFiles([item], Date.now())).toHaveLength(0)
  })

  it("renames generic 'image.png' file using timestamp", () => {
    const fakeFile = new File(["data"], "image.png", { type: "image/png" })
    const item: Pick<DataTransferItem, "kind" | "type" | "getAsFile"> = {
      kind: "file",
      type: "image/png",
      getAsFile: () => fakeFile,
    }
    const result = getClipboardImageFiles([item], 99999)
    expect(result[0].name).toBe("clipboard-99999.png")
  })

  it("keeps non-generic filenames unchanged", () => {
    const fakeFile = new File(["data"], "screenshot-2024.png", { type: "image/png" })
    const item: Pick<DataTransferItem, "kind" | "type" | "getAsFile"> = {
      kind: "file",
      type: "image/png",
      getAsFile: () => fakeFile,
    }
    const result = getClipboardImageFiles([item], 12345)
    expect(result[0].name).toBe("screenshot-2024.png")
  })
})

describe("normalizeClipboardImageFile", () => {
  it("returns the same File object when it already has a real name", () => {
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" })
    const result = normalizeClipboardImageFile(file, 0, 100)
    expect(result).toBe(file)
    expect(result.name).toBe("photo.jpg")
  })

  it("renames index-0 file as clipboard-<ts>.<ext>", () => {
    const file = new File(["x"], "image.png", { type: "image/png" })
    normalizeClipboardImageFile(file, 0, 9000)
    expect(file.name).toBe("clipboard-9000.png")
  })

  it("renames index-1+ file with suffix -1, -2, etc.", () => {
    const file = new File(["x"], "image.png", { type: "image/png" })
    normalizeClipboardImageFile(file, 2, 9000)
    expect(file.name).toBe("clipboard-9000-2.png")
  })
})

describe("trimTrailingPastedNewlines", () => {
  it("removes trailing LF", () => {
    expect(trimTrailingPastedNewlines("hello\n")).toBe("hello")
  })
  it("removes trailing CR+LF", () => {
    expect(trimTrailingPastedNewlines("hello\r\n")).toBe("hello")
  })
  it("removes multiple trailing newlines", () => {
    expect(trimTrailingPastedNewlines("hello\n\n\n")).toBe("hello")
  })
  it("leaves text without trailing newlines unchanged", () => {
    expect(trimTrailingPastedNewlines("hello world")).toBe("hello world")
  })
  it("leaves mid-string newlines alone", () => {
    expect(trimTrailingPastedNewlines("line1\nline2")).toBe("line1\nline2")
  })
})

describe("hasClipboardTextPayload", () => {
  it("returns false for null", () => {
    expect(hasClipboardTextPayload(null)).toBe(false)
  })
  it("returns true when text/plain present", () => {
    const dt = { types: ["text/plain"] } as unknown as DataTransfer
    expect(hasClipboardTextPayload(dt)).toBe(true)
  })
  it("returns true when text/html present", () => {
    const dt = { types: ["text/html"] } as unknown as DataTransfer
    expect(hasClipboardTextPayload(dt)).toBe(true)
  })
  it("returns false when neither text type is present", () => {
    const dt = { types: ["image/png"] } as unknown as DataTransfer
    expect(hasClipboardTextPayload(dt)).toBe(false)
  })
})

// ─── Tests: uploadAndInsertFiles ──────────────────────────────────────────────

describe("uploadAndInsertFiles", () => {
  it("uploads a single image file and inserts an AttachmentNode", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    const file = new File(["img"], "screenshot.png", { type: "image/png" })

    await uploadAndInsertFiles([file], editor, "chat-1", mockUpload)

    let nodeCount = 0
    editor.read(() => {
      nodeCount = $getAttachmentNodes().length
    })
    expect(nodeCount).toBe(1)
  })

  it("inserts one AttachmentNode per uploaded file", async () => {
    const editor = buildEditor()
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.jpg", { type: "image/jpeg" }),
    ]

    let callIndex = 0
    const attachments: ChatAttachment[] = [
      { ...fakeAttachment, id: "att-a" },
      { ...fakeAttachment, id: "att-b" },
    ]
    const mockUpload = mock(() => {
      const att = attachments[callIndex++]!
      return { promise: Promise.resolve({ attachments: [att] }), abort: () => {} }
    }) as unknown as UploadFileFn

    await uploadAndInsertFiles(files, editor, "chat-1", mockUpload)

    let ids: string[] = []
    editor.read(() => {
      ids = $getAttachmentNodes().map((n) => n.getAttachment().id)
    })
    expect(ids).toHaveLength(2)
    expect(ids).toContain("att-a")
    expect(ids).toContain("att-b")
  })

  it("calls onUploadError when upload returns no attachment", async () => {
    const editor = buildEditor()
    const mockUpload = mock(() => ({
      promise: Promise.resolve({ attachments: [] }),
      abort: () => {},
    })) as unknown as UploadFileFn

    const errors: string[] = []
    const file = new File(["x"], "x.png", { type: "image/png" })
    await uploadAndInsertFiles([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

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
      promise: Promise.reject(new Error("network error")),
      abort: () => {},
    })) as unknown as UploadFileFn

    const errors: string[] = []
    const file = new File(["x"], "x.png", { type: "image/png" })
    await uploadAndInsertFiles([file], editor, "chat-1", mockUpload, (msg) => errors.push(msg))

    expect(errors[0]).toContain("network error")
  })

  it("does nothing when files array is empty", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    await uploadAndInsertFiles([], editor, "chat-1", mockUpload)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("does nothing when files exceed MAX_FILES_PER_PASTE", async () => {
    const editor = buildEditor()
    const mockUpload = makeUploadFileMock()
    const files = Array.from({ length: MAX_FILES_PER_PASTE + 1 }, (_, i) =>
      new File(["x"], `img-${i}.png`, { type: "image/png" }),
    )
    await uploadAndInsertFiles(files, editor, "chat-1", mockUpload)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it("respects MAX_CONCURRENT_UPLOADS concurrency limit", async () => {
    const editor = buildEditor()
    let maxConcurrent = 0
    let current = 0

    const mockUpload = mock(() => ({
      promise: new Promise<{ attachments: ChatAttachment[] }>((resolve) => {
        current++
        if (current > maxConcurrent) maxConcurrent = current
        // resolve in a microtask to allow concurrency tracking
        Promise.resolve().then(() => {
          current--
          resolve({ attachments: [fakeAttachment] })
        })
      }),
      abort: () => {},
    })) as unknown as UploadFileFn

    const files = Array.from({ length: MAX_CONCURRENT_UPLOADS + 2 }, (_, i) =>
      new File(["x"], `img-${i}.png`, { type: "image/png" }),
    )
    await uploadAndInsertFiles(files, editor, "chat-1", mockUpload)
    expect(maxConcurrent).toBeLessThanOrEqual(MAX_CONCURRENT_UPLOADS)
  })
})
