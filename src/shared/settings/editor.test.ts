import { describe, expect, test } from "vite-plus/test"
import { EDITOR_PRESETS } from "../core-types"
import {
  DEFAULT_EDITOR_PRESET,
  getDefaultEditorCommandTemplate,
  getEditorPresetLabel,
  normalizeEditorCommandTemplate,
  normalizeEditorPreset,
} from "./editor"

describe("editor presets", () => {
  test("every preset has a label and a command template that opens a path", () => {
    for (const preset of EDITOR_PRESETS) {
      expect(getEditorPresetLabel(preset).length).toBeGreaterThan(0)
      expect(getDefaultEditorCommandTemplate(preset)).toContain("{path}")
    }
  })

  test("custom starts from the default editor's template", () => {
    expect(getDefaultEditorCommandTemplate("custom")).toBe(getDefaultEditorCommandTemplate(DEFAULT_EDITOR_PRESET))
  })

  test("normalizeEditorPreset falls back to the default for unknown values", () => {
    expect(normalizeEditorPreset("vscode")).toBe("vscode")
    expect(normalizeEditorPreset("emacs")).toBe(DEFAULT_EDITOR_PRESET)
    expect(normalizeEditorPreset(undefined)).toBe(DEFAULT_EDITOR_PRESET)
  })

  test("normalizeEditorCommandTemplate trims and falls back to the preset's template", () => {
    expect(normalizeEditorCommandTemplate("  zed {path}  ", "custom")).toBe("zed {path}")
    expect(normalizeEditorCommandTemplate("   ", "xcode")).toBe("xed {path}")
    expect(normalizeEditorCommandTemplate(undefined, "windsurf")).toBe("windsurf {path}")
  })
})
