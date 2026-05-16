import { describe, expect, test } from "bun:test"
import { buildProjectFileContentUrl } from "./projectFileUrl"

describe("buildProjectFileContentUrl", () => {
  test("encodes project id and segments", () => {
    expect(buildProjectFileContentUrl("proj a", "dir/sub dir/file.png")).toBe(
      "/api/projects/proj%20a/files/dir/sub%20dir/file.png/content",
    )
  })

  test("returns null when projectId is missing", () => {
    expect(buildProjectFileContentUrl(null, "x.png")).toBeNull()
    expect(buildProjectFileContentUrl(undefined, "x.png")).toBeNull()
    expect(buildProjectFileContentUrl("", "x.png")).toBeNull()
  })

  test("returns null when relativePath is missing", () => {
    expect(buildProjectFileContentUrl("p", null)).toBeNull()
    expect(buildProjectFileContentUrl("p", "")).toBeNull()
  })

  test("preserves single-segment path", () => {
    expect(buildProjectFileContentUrl("p", "file.png")).toBe("/api/projects/p/files/file.png/content")
  })
})
