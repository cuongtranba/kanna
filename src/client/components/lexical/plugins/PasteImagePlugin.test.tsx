import { describe, expect, it } from "bun:test"
import {
  getClipboardImageFiles,
  normalizeClipboardImageFile,
  trimTrailingPastedNewlines,
  hasClipboardTextPayload,
} from "./PasteImagePlugin"


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

  it("renames a pasted image the browser left unnamed using the clipboard timestamp", () => {
    const item: Pick<DataTransferItem, "kind" | "type" | "getAsFile"> = {
      kind: "file",
      type: "image/png",
      getAsFile: () => new File(["img"], "", { type: "image/png" }),
    }
    expect(getClipboardImageFiles([item], 456)[0]?.name).toBe("clipboard-456.png")
  })

  it("generates distinct names for multiple unnamed images in one paste event", () => {
    const unnamed = (type: string): Pick<DataTransferItem, "kind" | "type" | "getAsFile"> => ({
      kind: "file",
      type,
      getAsFile: () => new File(["x"], "", { type }),
    })
    const files = getClipboardImageFiles([unnamed("image/png"), unnamed("image/webp")], 789)
    expect(files.map((file) => file.name)).toEqual(["clipboard-789.png", "clipboard-789-1.webp"])
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


