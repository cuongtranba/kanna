import { describe, expect, test } from "bun:test"
import { toDraftAttachment, toWireAttachment, type ComposerAttachment } from "./chatTabScopedStore"

function composerAttachment(overrides: Partial<ComposerAttachment> = {}): ComposerAttachment {
  return {
    id: "a1",
    kind: "image",
    displayName: "shot.png",
    absolutePath: "/p/.kanna/uploads/shot.png",
    relativePath: "./.kanna/uploads/shot.png",
    contentUrl: "/api/projects/p1/uploads/shot.png/content",
    mimeType: "image/png",
    size: 12,
    status: "uploaded",
    previewUrl: "blob:preview",
    uploadProgress: 1,
    cancelUpload: () => undefined,
    ...overrides,
  }
}

describe("toWireAttachment", () => {
  test("keeps only the fields the server accepts, dropping composer state and the reused flag", () => {
    expect(toWireAttachment(composerAttachment({ reused: true }))).toEqual({
      id: "a1",
      kind: "image",
      displayName: "shot.png",
      absolutePath: "/p/.kanna/uploads/shot.png",
      relativePath: "./.kanna/uploads/shot.png",
      contentUrl: "/api/projects/p1/uploads/shot.png/content",
      mimeType: "image/png",
      size: 12,
    })
  })
})

describe("toDraftAttachment", () => {
  test("keeps the reused flag so a restored draft still refuses to delete a shared upload", () => {
    expect(toDraftAttachment(composerAttachment({ reused: true })).reused).toBe(true)
  })

  test("omits the reused key when the upload is not reused", () => {
    expect("reused" in toDraftAttachment(composerAttachment())).toBe(false)
  })

  test("drops transient composer state", () => {
    const draft = toDraftAttachment(composerAttachment())
    expect("previewUrl" in draft).toBe(false)
    expect("status" in draft).toBe(false)
  })
})
