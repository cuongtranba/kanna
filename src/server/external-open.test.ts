import { describe, expect, test } from "bun:test"
import { buildDefaultOpenCommand, buildEditorCommand, buildPreviewCommand, buildWslOpenCommand, tokenizeCommandTemplate } from "./external-open"

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

describe("buildWslOpenCommand", () => {
  const windowsPath = "\\\\wsl.localhost\\Ubuntu\\home\\cuong\\repo\\kanna"
  const explorerBinary = "/mnt/c/Windows/explorer.exe"
  const cmdBinary = "/mnt/c/Windows/System32/cmd.exe"

  test("opens a directory in Explorer for open_finder", () => {
    expect(
      buildWslOpenCommand({ action: "open_finder", windowsPath, isDirectory: true, explorerBinary, cmdBinary: null })
    ).toEqual({ command: explorerBinary, args: [windowsPath] })
  })

  test("reveals a file with /select, for open_finder", () => {
    const filePath = "\\\\wsl.localhost\\Ubuntu\\home\\cuong\\repo\\kanna\\mock.png"
    expect(
      buildWslOpenCommand({ action: "open_finder", windowsPath: filePath, isDirectory: false, explorerBinary, cmdBinary: null })
    ).toEqual({ command: explorerBinary, args: [`/select,${filePath}`] })
  })

  test("opens with the default handler for open_default", () => {
    expect(
      buildWslOpenCommand({ action: "open_default", windowsPath, isDirectory: false, explorerBinary, cmdBinary: null })
    ).toEqual({ command: explorerBinary, args: [windowsPath] })
  })

  test("launches Windows Terminal via cmd start for open_terminal", () => {
    expect(
      buildWslOpenCommand({ action: "open_terminal", windowsPath, isDirectory: true, explorerBinary, cmdBinary })
    ).toEqual({ command: cmdBinary, args: ["/c", "start", "", "wt.exe", "-d", windowsPath] })
  })

  test("rejects open_terminal when cmd.exe cannot be located", () => {
    expect(() =>
      buildWslOpenCommand({ action: "open_terminal", windowsPath, isDirectory: true, explorerBinary, cmdBinary: null })
    ).toThrow("Unable to locate cmd.exe to launch a Windows terminal")
  })
})
