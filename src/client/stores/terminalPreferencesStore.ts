import { create } from "zustand"
import type { EditorPreset } from "../../shared/protocol"
import {
  DEFAULT_EDITOR_PRESET,
  getDefaultEditorCommandTemplate,
  getEditorPresetLabel,
  normalizeEditorCommandTemplate,
  normalizeEditorPreset,
} from "../../shared/settings/editor"
import { clampTerminalMinColumnWidth, DEFAULT_TERMINAL_MIN_COLUMN_WIDTH } from "../../shared/terminal-column-width"
import { clampScrollback, DEFAULT_TERMINAL_SCROLLBACK } from "../../shared/terminal-scrollback"

export {
  DEFAULT_TERMINAL_SCROLLBACK,
  MIN_TERMINAL_SCROLLBACK,
  MAX_TERMINAL_SCROLLBACK,
} from "../../shared/terminal-scrollback"
export {
  DEFAULT_TERMINAL_MIN_COLUMN_WIDTH,
  MAX_TERMINAL_MIN_COLUMN_WIDTH,
  MIN_TERMINAL_MIN_COLUMN_WIDTH,
} from "../../shared/terminal-column-width"
export { DEFAULT_EDITOR_PRESET, getDefaultEditorCommandTemplate, getEditorPresetLabel }

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
    setMinColumnWidth: (minColumnWidth) => set({ minColumnWidth: clampTerminalMinColumnWidth(minColumnWidth) }),
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
