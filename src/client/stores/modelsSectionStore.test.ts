import { test, expect, describe, beforeEach } from "bun:test"
import { useModelsSectionStore } from "./modelsSectionStore"

beforeEach(() => {
  useModelsSectionStore.getState().setEditing({ kind: "list" })
  useModelsSectionStore.getState().resetEditorForm("", "", "claude", false)
})

describe("modelsSectionStore", () => {
  test("resetEditorForm seeds the draft and clears submit state", () => {
    useModelsSectionStore.getState().patchEditorForm({ submitting: true, error: "stale" })
    useModelsSectionStore.getState().resetEditorForm("gpt-5.5", "GPT-5.5", "codex", true)

    expect(useModelsSectionStore.getState().editorForm).toEqual({
      id: "gpt-5.5",
      label: "GPT-5.5",
      modelProvider: "codex",
      supportsEffort: true,
      submitting: false,
      error: null,
    })
  })

  test("patchEditorForm merges without disturbing untouched fields", () => {
    useModelsSectionStore.getState().resetEditorForm("gpt-5.5", "GPT-5.5", "codex", true)
    useModelsSectionStore.getState().patchEditorForm({ label: "GPT-5.5 Turbo" })

    const form = useModelsSectionStore.getState().editorForm
    expect(form.label).toBe("GPT-5.5 Turbo")
    expect(form.id).toBe("gpt-5.5")
    expect(form.modelProvider).toBe("codex")
    expect(form.supportsEffort).toBe(true)
  })

  test("patchEditorForm applies every key of a multi-field patch at once", () => {
    useModelsSectionStore.getState().patchEditorForm({ submitting: true, error: null })
    expect(useModelsSectionStore.getState().editorForm.submitting).toBe(true)

    useModelsSectionStore.getState().patchEditorForm({ submitting: false, error: "boom" })
    const form = useModelsSectionStore.getState().editorForm
    expect(form.submitting).toBe(false)
    expect(form.error).toBe("boom")
  })

  test("patchEditorForm produces a new object so subscribers re-render", () => {
    const before = useModelsSectionStore.getState().editorForm
    useModelsSectionStore.getState().patchEditorForm({ label: "next" })
    expect(useModelsSectionStore.getState().editorForm).not.toBe(before)
  })
})
