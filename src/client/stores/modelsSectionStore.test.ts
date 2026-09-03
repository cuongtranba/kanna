import { test, expect, describe, beforeEach } from "bun:test"
import { useModelsSectionStore } from "./modelsSectionStore"

beforeEach(() => {
  useModelsSectionStore.getState().setEditing({ kind: "list" })
  useModelsSectionStore.getState().resetEditorForm({ id: "", label: "", modelProvider: "claude", supportedEfforts: [], offersOneMillionContext: false })
})

describe("modelsSectionStore", () => {
  test("resetEditorForm seeds the draft and clears submit state", () => {
    useModelsSectionStore.getState().patchEditorForm({ submitting: true, error: "stale" })
    useModelsSectionStore.getState().resetEditorForm({ id: "gpt-5.5", label: "GPT-5.5", modelProvider: "codex", supportedEfforts: [], offersOneMillionContext: false })

    expect(useModelsSectionStore.getState().editorForm).toEqual({
      id: "gpt-5.5",
      label: "GPT-5.5",
      modelProvider: "codex",
      supportedEfforts: [],
      offersOneMillionContext: false,
      submitting: false,
      error: null,
    })
  })

  test("patchEditorForm merges without disturbing untouched fields", () => {
    useModelsSectionStore.getState().resetEditorForm({ id: "gpt-5.5", label: "GPT-5.5", modelProvider: "codex", supportedEfforts: [], offersOneMillionContext: false })
    useModelsSectionStore.getState().patchEditorForm({ label: "GPT-5.5 Turbo" })

    const form = useModelsSectionStore.getState().editorForm
    expect(form.label).toBe("GPT-5.5 Turbo")
    expect(form.id).toBe("gpt-5.5")
    expect(form.modelProvider).toBe("codex")
    expect(form.supportedEfforts).toEqual([])
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

  test("toggleSupportedEffort adds and removes effort levels from the store", () => {
    useModelsSectionStore.getState().resetEditorForm({ id: "claude-x", label: "X", modelProvider: "claude", supportedEfforts: [], offersOneMillionContext: false })
    useModelsSectionStore.getState().toggleSupportedEffort("high")
    useModelsSectionStore.getState().toggleSupportedEffort("max")
    expect(useModelsSectionStore.getState().editorForm.supportedEfforts).toEqual(["high", "max"])
    useModelsSectionStore.getState().toggleSupportedEffort("high")
    expect(useModelsSectionStore.getState().editorForm.supportedEfforts).toEqual(["max"])
  })

  test("toggleOneMillionContext flips the context-window choice", () => {
    expect(useModelsSectionStore.getState().editorForm.offersOneMillionContext).toBe(false)
    useModelsSectionStore.getState().toggleOneMillionContext()
    expect(useModelsSectionStore.getState().editorForm.offersOneMillionContext).toBe(true)
    useModelsSectionStore.getState().toggleOneMillionContext()
    expect(useModelsSectionStore.getState().editorForm.offersOneMillionContext).toBe(false)
  })

  test("resetEditorForm carries the context-window choice in", () => {
    useModelsSectionStore.getState().resetEditorForm({
      id: "claude-opus-5", label: "Opus 5", modelProvider: "claude",
      supportedEfforts: ["high"], offersOneMillionContext: true,
    })
    expect(useModelsSectionStore.getState().editorForm.offersOneMillionContext).toBe(true)
  })
})
