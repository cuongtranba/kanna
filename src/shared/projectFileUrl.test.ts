import { describe, expect, test } from "bun:test"
import {
  buildContentUrlForFilePath,
  buildLocalFileContentUrl,
  buildProjectFileContentUrl,
  isAbsoluteFilePath,
} from "./projectFileUrl"

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

describe("buildLocalFileContentUrl", () => {
  test("encodes absolute POSIX path", () => {
    expect(buildLocalFileContentUrl("/Users/x/.codex/generated_images/ig_07031bcd.png")).toBe(
      "/api/local-file?path=%2FUsers%2Fx%2F.codex%2Fgenerated_images%2Fig_07031bcd.png",
    )
  })

  test("encodes paths containing spaces", () => {
    expect(buildLocalFileContentUrl("/Users/x/Pictures/ig 1.png")).toBe(
      "/api/local-file?path=%2FUsers%2Fx%2FPictures%2Fig%201.png",
    )
  })
})

describe("isAbsoluteFilePath", () => {
  test("detects POSIX absolute paths", () => {
    expect(isAbsoluteFilePath("/Users/x/foo.png")).toBe(true)
    expect(isAbsoluteFilePath("/")).toBe(true)
  })

  test("detects Windows drive paths", () => {
    expect(isAbsoluteFilePath("C:\\Users\\x\\foo.png")).toBe(true)
    expect(isAbsoluteFilePath("D:/Users/x/foo.png")).toBe(true)
  })

  test("rejects relative paths", () => {
    expect(isAbsoluteFilePath("dir/file.png")).toBe(false)
    expect(isAbsoluteFilePath("file.png")).toBe(false)
    expect(isAbsoluteFilePath("../file.png")).toBe(false)
    expect(isAbsoluteFilePath("")).toBe(false)
  })
})

describe("buildContentUrlForFilePath", () => {
  test("routes absolute paths to /api/local-file", () => {
    expect(
      buildContentUrlForFilePath("proj-img", "/Users/x/.codex/generated_images/019e/ig_07031bcd.png"),
    ).toBe(
      "/api/local-file?path=%2FUsers%2Fx%2F.codex%2Fgenerated_images%2F019e%2Fig_07031bcd.png",
    )
  })

  test("routes relative paths to project file endpoint", () => {
    expect(buildContentUrlForFilePath("proj-dig", "generated_images/019e/ig_abc.png")).toBe(
      "/api/projects/proj-dig/files/generated_images/019e/ig_abc.png/content",
    )
  })

  test("absolute path works without a projectId", () => {
    expect(buildContentUrlForFilePath(null, "/Users/x/foo.png")).toBe(
      "/api/local-file?path=%2FUsers%2Fx%2Ffoo.png",
    )
  })

  test("returns null when relative path has no projectId", () => {
    expect(buildContentUrlForFilePath(null, "file.png")).toBeNull()
  })

  test("returns null when filePath is missing", () => {
    expect(buildContentUrlForFilePath("p", null)).toBeNull()
    expect(buildContentUrlForFilePath("p", "")).toBeNull()
  })
})
