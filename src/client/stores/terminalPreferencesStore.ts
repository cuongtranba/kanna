import { create } from "zustand"
import type { EditorPreset } from "../../shared/protocol"

export const DEFAULT_TERMINAL_SCROLLBACK = 1_000
export const MIN_TERMINAL_SCROLLBACK = 500
export const MAX_TERMINAL_SCROLLBACK = 5_000
export const DEFAULT_TERMINAL_MIN_COLUMN_WIDTH = 450
export const MIN_TERMINAL_MIN_COLUMN_WIDTH = 250
export const MAX_TERMINAL_MIN_COLUMN_WIDTH = 900
export const DEFAULT_EDITOR_PRESET: EditorPreset = "cursor"

export function getDefaultEditorCommandTemplate(preset: EditorPreset) {
  switch (preset) {
    case "vscode":
      return "code {path}"
    case "xcode":
      return "xed {path}"
    case "windsurf":
      return "windsurf {path}"
    case "custom":
      return "cursor {path}"
    case "cursor":
    default:
      return "cursor {path}"
  }
}

export function getEditorPresetLabel(preset: EditorPreset) {
  switch (preset) {
    case "vscode":
      return "VS Code"
    case "xcode":
      return "Xcode"
    case "windsurf":
      return "Windsurf"
    case "custom":
      return "Custom"
    case "cursor":
    default:
      return "Cursor"
  }
}

function clampScrollback(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_SCROLLBACK
  return Math.min(MAX_TERMINAL_SCROLLBACK, Math.max(MIN_TERMINAL_SCROLLBACK, Math.round(value)))
}

function clampMinColumnWidth(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_TERMINAL_MIN_COLUMN_WIDTH
  return Math.min(MAX_TERMINAL_MIN_COLUMN_WIDTH, Math.max(MIN_TERMINAL_MIN_COLUMN_WIDTH, Math.round(value)))
}

function normalizeEditorPreset(value?: string): EditorPreset {
  switch (value) {
    case "vscode":
    case "xcode":
    case "windsurf":
    case "custom":
    case "cursor":
      return value
    default:
      return DEFAULT_EDITOR_PRESET
  }
}

function normalizeEditorCommandTemplate(value: string | undefined, preset: EditorPreset) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : getDefaultEditorCommandTemplate(preset)
}

interface TerminalPreferencesState {
  scrollbackLines: number
  minColumnWidth: number
  editorPreset: EditorPreset
  editorCommandTemplate: string
  setScrollbackLines: (scrollbackLines: number) => void
  setMinColumnWidth: (minColumnWidth: number) => void
  setEditorPreset: (editorPreset: EditorPreset) => void
  setEditorCommandTemplate: (editorCommandTemplate: string) => void
}

export const useTerminalPreferencesStore = create<TerminalPreferencesState>()(
  (set) => ({
    scrollbackLines: DEFAULT_TERMINAL_SCROLLBACK,
    minColumnWidth: DEFAULT_TERMINAL_MIN_COLUMN_WIDTH,
    editorPreset: DEFAULT_EDITOR_PRESET,
    editorCommandTemplate: getDefaultEditorCommandTemplate(DEFAULT_EDITOR_PRESET),
    setScrollbackLines: (scrollbackLines) => set({ scrollbackLines: clampScrollback(scrollbackLines) }),
    setMinColumnWidth: (minColumnWidth) => set({ minColumnWidth: clampMinColumnWidth(minColumnWidth) }),
    setEditorPreset: (editorPreset) =>
      set((state) => {
        const normalizedPreset = normalizeEditorPreset(editorPreset)
        return {
          editorPreset: normalizedPreset,
          editorCommandTemplate:
            normalizedPreset === "custom"
              ? normalizeEditorCommandTemplate(state.editorCommandTemplate, normalizedPreset)
              : getDefaultEditorCommandTemplate(normalizedPreset),
        }
      }),
    setEditorCommandTemplate: (editorCommandTemplate) =>
      set((state) => ({
        editorCommandTemplate: normalizeEditorCommandTemplate(editorCommandTemplate, state.editorPreset),
      })),
  })
)
