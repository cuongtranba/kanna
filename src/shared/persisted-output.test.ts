import { describe, expect, test } from "bun:test"
import {
  PERSISTED_PREVIEW_BYTES,
  buildPersistedPreview,
  stripPersistedOutput,
  wrapPersistedOutput,
} from "./persisted-output"

describe("persisted output envelope", () => {
  test("wrap then strip leaves the saved-to-disk notice and the preview", () => {
    const wrapped = wrapPersistedOutput({ filePath: "/tmp/out.txt", originalSize: 60_000, serialized: "short body" })
    expect(wrapped.startsWith("<persisted-output>\n")).toBe(true)
    expect(wrapped.endsWith("</persisted-output>")).toBe(true)
    const stripped = stripPersistedOutput(wrapped)
    expect(stripped).not.toContain("persisted-output")
    expect(stripped).toContain("Full output saved to: /tmp/out.txt")
    expect(stripped).toContain("short body")
  })

  test("a preview over the byte limit is cut and marked as truncated", () => {
    const { preview, hasMore } = buildPersistedPreview("x".repeat(PERSISTED_PREVIEW_BYTES * 2))
    expect(hasMore).toBe(true)
    expect(preview.length).toBeLessThanOrEqual(PERSISTED_PREVIEW_BYTES)
  })

  test("a cut never ends in a half-written multi-byte character", () => {
    const { preview } = buildPersistedPreview("é".repeat(PERSISTED_PREVIEW_BYTES))
    expect(preview.includes("�")).toBe(false)
  })

  test("a preview within the limit is returned whole", () => {
    expect(buildPersistedPreview("tiny")).toEqual({ preview: "tiny", hasMore: false })
  })
})
