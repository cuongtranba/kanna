import { describe, expect, test } from "bun:test"
import { getOpenAppItems } from "./open-external-menu"

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
