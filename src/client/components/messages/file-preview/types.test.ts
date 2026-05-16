import { describe, expect, test } from "bun:test"
import { toPreviewSourceFromAttachment, type PreviewSource } from "./types"
import type { ChatAttachment } from "../../../../shared/types"

describe("toPreviewSourceFromAttachment", () => {
  test("maps ChatAttachment fields onto PreviewSource with given origin", () => {
    const attachment: ChatAttachment = {
      id: "att-1",
      kind: "file",
      displayName: "report.pdf",
      absolutePath: "/a/report.pdf",
      relativePath: "a/report.pdf",
      contentUrl: "/api/x",
      mimeType: "application/pdf",
      size: 1024,
    }
    const source: PreviewSource = toPreviewSourceFromAttachment(attachment, "user_attachment")
    expect(source).toEqual({
      id: "att-1",
      contentUrl: "/api/x",
      displayName: "report.pdf",
      fileName: "report.pdf",
      relativePath: "a/report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      origin: "user_attachment",
    })
  })

  test("falls back to displayName for fileName when missing", () => {
    const source = toPreviewSourceFromAttachment(
      { id: "x", kind: "file", displayName: "doc.txt", mimeType: "text/plain", size: 0, contentUrl: "/u" } as ChatAttachment,
      "local_file_link",
    )
    expect(source.fileName).toBe("doc.txt")
  })
})
