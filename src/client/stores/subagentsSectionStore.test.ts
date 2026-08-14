import { test, expect, describe, beforeEach } from "bun:test"
import { useSubagentsSectionStore } from "./subagentsSectionStore"
import { DEFAULT_CLAUDE_MODEL_OPTIONS, type SubagentInput } from "../../shared/types"

function draft(over: Partial<SubagentInput> = {}): SubagentInput {
  return {
    name: "reviewer",
    provider: "claude",
    model: "claude-opus-4-8",
    modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS },
    systemPrompt: "review it",
    contextScope: "previous-assistant-reply",
    triggerMode: "auto",
    ...over,
  }
}

beforeEach(() => {
  useSubagentsSectionStore.getState().setEditing({ kind: "list" })
  useSubagentsSectionStore.getState().resetForm(draft())
})

describe("subagentsSectionStore", () => {
  test("resetForm seeds the draft and clears error/pending/confirm", () => {
    useSubagentsSectionStore
      .getState()
      .patchForm({ pending: true, confirmDelete: true, error: { field: "name", message: "taken" } })

    useSubagentsSectionStore.getState().resetForm(draft({ name: "planner" }))

    const form = useSubagentsSectionStore.getState().form
    expect(form.draft.name).toBe("planner")
    expect(form.error).toBeNull()
    expect(form.pending).toBe(false)
    expect(form.confirmDelete).toBe(false)
  })

  test("patchForm merges top-level fields and leaves the draft alone", () => {
    useSubagentsSectionStore.getState().patchForm({ pending: true })

    const form = useSubagentsSectionStore.getState().form
    expect(form.pending).toBe(true)
    expect(form.draft.name).toBe("reviewer")
    expect(form.confirmDelete).toBe(false)
  })

  test("patchFormDraft reaches the nested draft that patchForm cannot", () => {
    useSubagentsSectionStore.getState().patchForm({ error: { field: "name", message: "taken" } })
    useSubagentsSectionStore.getState().patchFormDraft({ name: "renamed" })

    const form = useSubagentsSectionStore.getState().form
    expect(form.draft.name).toBe("renamed")
    // Untouched draft fields survive the patch...
    expect(form.draft.systemPrompt).toBe("review it")
    // ...and so does unrelated form state.
    expect(form.error).toEqual({ field: "name", message: "taken" })
  })

  test("a provider switch rewrites model + options in one draft patch", () => {
    useSubagentsSectionStore.getState().patchFormDraft({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "low", fastMode: false },
    })

    const { draft: next } = useSubagentsSectionStore.getState().form
    expect(next.provider).toBe("codex")
    expect(next.model).toBe("gpt-5.3-codex")
    expect(next.name).toBe("reviewer")
  })
})
