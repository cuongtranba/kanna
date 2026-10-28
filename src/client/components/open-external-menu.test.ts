import { describe, expect, test } from "vite-plus/test"
import { formatOpenAppValue, getOpenAppItems, getOpenAppLabel, openAppTarget, parseOpenAppValue } from "./open-external-menu"

describe("getOpenAppItems", () => {
  test("keeps the default editor first and custom hidden unless it is default", () => {
    expect(getOpenAppItems({
      editorPreset: "windsurf",
      isMac: true,
      includeFinder: true,
      includeTerminal: false,
      includePreview: true,
    }).map((item) => item.value)).toEqual([
      "editor:windsurf",
      "editor:cursor",
      "editor:xcode",
      "preview",
      "finder",
    ])
  })

  test("includes custom only when custom is the default editor", () => {
    expect(getOpenAppItems({
      editorPreset: "custom",
      isMac: true,
      includeFinder: true,
      includeTerminal: false,
      includePreview: true,
    }).map((item) => item.value)).toEqual([
      "editor:custom",
      "editor:cursor",
      "editor:xcode",
      "editor:windsurf",
      "preview",
      "finder",
    ])
  })

  test("hides Preview off macOS", () => {
    expect(getOpenAppItems({
      editorPreset: "cursor",
      isMac: false,
      includeFinder: true,
      includeTerminal: false,
      includePreview: true,
    }).map((item) => item.value)).toEqual([
      "editor:cursor",
      "editor:xcode",
      "editor:windsurf",
      "finder",
    ])
  })

  test("puts Default App last when it is included", () => {
    expect(getOpenAppItems({
      editorPreset: "cursor",
      isMac: true,
      includeFinder: true,
      includeTerminal: false,
      includePreview: true,
      includeDefault: true,
    }).map((item) => item.value)).toEqual([
      "editor:cursor",
      "editor:xcode",
      "editor:windsurf",
      "preview",
      "finder",
      "default",
    ])
  })

  test("orders the navbar menu with Finder and Terminal after the default editor", () => {
    expect(getOpenAppItems({
      editorPreset: "cursor",
      isMac: true,
      includeFinder: true,
      includeTerminal: true,
      menuKind: "navbar",
    }).map((item) => item.value)).toEqual([
      "editor:cursor",
      "finder",
      "terminal",
      "editor:xcode",
      "editor:windsurf",
    ])
  })
})

describe("parseOpenAppValue / formatOpenAppValue", () => {
  test("round-trips every fixed destination and editor preset", () => {
    const values = ["finder", "terminal", "preview", "default", "editor:cursor", "editor:vscode", "editor:custom"]
    const roundTripped = values.map((value) => {
      const target = parseOpenAppValue(value)
      return target ? formatOpenAppValue(target) : null
    })
    expect(roundTripped.join(",")).toBe(values.join(","))
  })

  test("rejects stored values it does not recognise", () => {
    expect(parseOpenAppValue(null)).toBeNull()
    expect(parseOpenAppValue("editor:emacs")).toBeNull()
    expect(parseOpenAppValue("somewhere")).toBeNull()
  })
})

describe("getOpenAppLabel", () => {
  test("names Finder per platform and editors by their preset", () => {
    expect(getOpenAppLabel({ kind: "finder" }, true)).toBe("Finder")
    expect(getOpenAppLabel({ kind: "finder" }, false)).toBe("Folder")
    expect(getOpenAppLabel({ kind: "editor", preset: "vscode" }, true)).toBe("VS Code")
  })
})

describe("openAppTarget", () => {
  test("dispatches fixed destinations to their open action and editors with their template", () => {
    const calls: Array<[string, unknown]> = []
    const onOpenExternal = (action: string, editor?: unknown) => {
      calls.push([action, editor])
    }
    openAppTarget({ target: { kind: "terminal" }, onOpenExternal })
    openAppTarget({ target: { kind: "editor", preset: "xcode" }, onOpenExternal })
    expect(calls[0]).toEqual(["open_terminal", undefined])
    expect(calls[1]?.[0]).toBe("open_editor")
  })
})
