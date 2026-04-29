import { describe, expect, test } from "bun:test"
import { buildDefaultOpenCommand, buildEditorCommand, buildPreviewCommand, tokenizeCommandTemplate } from "./external-open"

describe("tokenizeCommandTemplate", () => {
  test("keeps quoted arguments together", () => {
    expect(tokenizeCommandTemplate('code --reuse-window "{path}"')).toEqual([
      "code",
      "--reuse-window",
      "{path}",
    ])
  })
})

describe("buildEditorCommand", () => {
  test("builds a preset goto command for file links", () => {
    expect(
      buildEditorCommand({
        localPath: "/Users/jake/Projects/kanna/src/client/app/App.tsx",
        isDirectory: false,
        line: 12,
        column: 3,
        editor: { preset: "vscode", commandTemplate: "code {path}" },
        platform: "linux",
      })
    ).toEqual({
      command: "code",
      args: ["--goto", "/Users/jake/Projects/kanna/src/client/app/App.tsx:12:3"],
    })
  })

  test("builds a preset project command for directory opens", () => {
    expect(
      buildEditorCommand({
        localPath: "/Users/jake/Projects/kanna",
        isDirectory: true,
        editor: { preset: "cursor", commandTemplate: "cursor {path}" },
        platform: "linux",
      })
    ).toEqual({
      command: "cursor",
      args: ["/Users/jake/Projects/kanna"],
    })
  })

  test("uses the custom template for editor opens", () => {
    expect(
      buildEditorCommand({
        localPath: "/Users/jake/Projects/kanna/src/client/app/App.tsx",
        isDirectory: false,
        line: 12,
        column: 1,
        editor: { preset: "custom", commandTemplate: 'my-editor "{path}" --line {line}' },
        platform: "linux",
      })
    ).toEqual({
      command: "my-editor",
      args: ["/Users/jake/Projects/kanna/src/client/app/App.tsx", "--line", "12"],
    })
  })

  test("builds an Xcode line command with xed", () => {
    expect(
      buildEditorCommand({
        localPath: "/Users/jake/Projects/kanna/App.swift",
        isDirectory: false,
        line: 24,
        column: 2,
        editor: { preset: "xcode", commandTemplate: "xed {path}" },
        platform: "linux",
      })
    ).toEqual({
      command: "xed",
      args: ["-l", "24", "/Users/jake/Projects/kanna/App.swift"],
    })
  })
})

describe("buildPreviewCommand", () => {
  test("builds a native macOS Preview open command", () => {
    expect(
      buildPreviewCommand({
        localPath: "/Users/jake/Projects/kanna/mock.png",
        isDirectory: false,
        platform: "darwin",
      })
    ).toEqual({
      command: "open",
      args: ["-a", "Preview", "/Users/jake/Projects/kanna/mock.png"],
    })
  })

  test("rejects non-macOS platforms", () => {
    expect(() => buildPreviewCommand({
      localPath: "/Users/jake/Projects/kanna/mock.png",
      isDirectory: false,
      platform: "linux",
    })).toThrow("Preview is only available on macOS")
  })
})

describe("buildDefaultOpenCommand", () => {
  test("builds default open commands for supported platforms", () => {
    expect(buildDefaultOpenCommand({ localPath: "/Users/jake/Projects/kanna/mock.png", platform: "darwin" })).toEqual({
      command: "open",
      args: ["/Users/jake/Projects/kanna/mock.png"],
    })
    expect(buildDefaultOpenCommand({ localPath: "/tmp/mock.png", platform: "linux" })).toEqual({
      command: "xdg-open",
      args: ["/tmp/mock.png"],
    })
  })
})
