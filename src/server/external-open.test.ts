import { describe, expect, test } from "bun:test"
import { buildEditorCommand, tokenizeCommandTemplate } from "./external-open"

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
