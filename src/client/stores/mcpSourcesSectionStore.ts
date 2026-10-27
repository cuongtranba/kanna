import { create } from "zustand"
import { applyZaloPreset, draftFromMcpSource, emptyMcpSourceDraft, type McpSourceDraft } from "../lib/mcpSourceDraft"
import type { McpSource } from "../../shared/mcp-sources/types"
import { LIST_EDITING, type SectionEditing } from "../lib/sectionEditing"

interface McpSourcesSectionState {
  editing: SectionEditing
  draft: McpSourceDraft
  error: string | null
  confirmingDeleteId: string | null
  startCreate(): void
  startEdit(source: McpSource): void
  closeEditor(): void
  patchDraft(patch: Partial<McpSourceDraft>): void
  applyZaloPreset(): void
  setError(error: string | null): void
  askDelete(id: string): void
  cancelDelete(): void
}

export const useMcpSourcesSectionStore = create<McpSourcesSectionState>()((set) => ({
  editing: LIST_EDITING,
  draft: emptyMcpSourceDraft(),
  error: null,
  confirmingDeleteId: null,
  startCreate: () => set({ editing: { kind: "create" }, draft: emptyMcpSourceDraft(), error: null }),
  startEdit: (source) => set({ editing: { kind: "edit", id: source.id }, draft: draftFromMcpSource(source), error: null }),
  closeEditor: () => set({ editing: LIST_EDITING, error: null }),
  patchDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  applyZaloPreset: () => set((state) => ({ draft: applyZaloPreset(state.draft) })),
  setError: (error) => set({ error }),
  askDelete: (id) => set({ confirmingDeleteId: id }),
  cancelDelete: () => set({ confirmingDeleteId: null }),
}))
