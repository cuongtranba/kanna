import { isEditorPreset } from "../app-settings-types"
import type { EditorPreset } from "../core-types"

export const DEFAULT_EDITOR_PRESET: EditorPreset = "cursor"

const EDITOR_PRESET_INFO: Readonly<Record<EditorPreset, { label: string; commandTemplate: string }>> = {
  cursor: { label: "Cursor", commandTemplate: "cursor {path}" },
  vscode: { label: "VS Code", commandTemplate: "code {path}" },
  xcode: { label: "Xcode", commandTemplate: "xed {path}" },
  windsurf: { label: "Windsurf", commandTemplate: "windsurf {path}" },
  custom: { label: "Custom", commandTemplate: "cursor {path}" },
}

export function getEditorPresetLabel(preset: EditorPreset): string {
  return EDITOR_PRESET_INFO[preset].label
}

export function getDefaultEditorCommandTemplate(preset: EditorPreset): string {
  return EDITOR_PRESET_INFO[preset].commandTemplate
}

export function normalizeEditorPreset<T>(value: T): EditorPreset {
  return isEditorPreset(value) ? value : DEFAULT_EDITOR_PRESET
}

export function normalizeEditorCommandTemplate<T>(value: T, preset: EditorPreset): string {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed || getDefaultEditorCommandTemplate(preset)
}
