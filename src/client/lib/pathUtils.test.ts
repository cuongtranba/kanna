import { describe, expect, test } from "bun:test"
import { isAbsoluteLocalFilePath, parseLocalFileLink, shouldOpenLocalFileLinkInEditor, toLocalFileUrl } from "./pathUtils"

describe("parseLocalFileLink", () => {
  test("parses an absolute file path with a line fragment", () => {
    expect(parseLocalFileLink("/Users/jake/Projects/kanna/src/app.ts#L12")).toEqual({
      path: "/Users/jake/Projects/kanna/src/app.ts",
      line: 12,
      column: undefined,
    })
  })

  test("parses an absolute file path without a fragment", () => {
    expect(parseLocalFileLink("/Users/jake/Projects/kanna/src/app.ts")).toEqual({
      path: "/Users/jake/Projects/kanna/src/app.ts",
    })
  })

  test("parses an absolute file path with a line suffix", () => {
    expect(parseLocalFileLink("/Users/jake/Kanna/superwall-agent/scripts/e2b-proxy.mjs:1")).toEqual({
      path: "/Users/jake/Kanna/superwall-agent/scripts/e2b-proxy.mjs",
      line: 1,
      column: undefined,
    })
  })

  test("parses an absolute file path with line and column suffixes", () => {
    expect(parseLocalFileLink("/Users/jake/Kanna/superwall-agent/scripts/e2b-proxy.mjs:1:2")).toEqual({
      path: "/Users/jake/Kanna/superwall-agent/scripts/e2b-proxy.mjs",
      line: 1,
      column: 2,
    })
  })

  test("parses same-origin absolute file urls with a line suffix", () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          origin: "http://localhost:9000",
        },
      },
      configurable: true,
    })

    try {
      expect(parseLocalFileLink("http://localhost:9000/Users/jake/Kanna/superwall-agent/scripts/e2b-proxy.mjs:1")).toEqual({
        path: "/Users/jake/Kanna/superwall-agent/scripts/e2b-proxy.mjs",
        line: 1,
        column: undefined,
      })
    } finally {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
      })
    }
  })

  test("does not treat web links as local file links", () => {
    expect(parseLocalFileLink("https://example.com")).toBeNull()
  })
})

describe("shouldOpenLocalFileLinkInEditor", () => {
  test("opens source, markdown, and text files in the editor", () => {
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/src/app.ts")).toBe(true)
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/README.md")).toBe(true)
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/notes.txt")).toBe(true)
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/.gitignore")).toBe(true)
  })

  test("opens media and document files in the default app", () => {
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/shot.png")).toBe(false)
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/movie.mp4")).toBe(false)
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/report.docx")).toBe(false)
    expect(shouldOpenLocalFileLinkInEditor("/Users/jake/Projects/kanna/archive.zip")).toBe(false)
  })
})

describe("isAbsoluteLocalFilePath", () => {
  test("detects macOS, linux and temp roots and file:// URLs", () => {
    expect(isAbsoluteLocalFilePath("/Users/cuongtran/.codex/generated_images/foo.png")).toBe(true)
    expect(isAbsoluteLocalFilePath("/home/user/foo.png")).toBe(true)
    expect(isAbsoluteLocalFilePath("/tmp/foo.png")).toBe(true)
    expect(isAbsoluteLocalFilePath("/private/var/foo.png")).toBe(true)
    expect(isAbsoluteLocalFilePath("file:///Users/cuongtran/foo.png")).toBe(true)
  })

  test("rejects app routes and remote URLs", () => {
    expect(isAbsoluteLocalFilePath("/api/projects/p1/files/foo.png/content")).toBe(false)
    expect(isAbsoluteLocalFilePath("/assets/foo.png")).toBe(false)
    expect(isAbsoluteLocalFilePath("https://example.com/foo.png")).toBe(false)
    expect(isAbsoluteLocalFilePath("")).toBe(false)
  })
})

describe("toLocalFileUrl", () => {
  test("encodes an absolute path into /api/local-file query", () => {
    expect(toLocalFileUrl("/Users/cuongtran/.codex/generated_images/ig 01.png")).toBe(
      "/api/local-file?path=%2FUsers%2Fcuongtran%2F.codex%2Fgenerated_images%2Fig%2001.png"
    )
  })

  test("strips file:// prefix before encoding", () => {
    expect(toLocalFileUrl("file:///Users/cuongtran/foo.png")).toBe(
      "/api/local-file?path=%2FUsers%2Fcuongtran%2Ffoo.png"
    )
  })
})
