import { test, expect, describe, beforeEach } from "bun:test"
import { useTextSnippetsSectionStore } from "./textSnippetsSectionStore"

beforeEach(() => {
  useTextSnippetsSectionStore.getState().setEditing({ kind: "list" })
  useTextSnippetsSectionStore.getState().resetEditorForm("", "")
})

describe("textSnippetsSectionStore", () => {
  test("resetEditorForm seeds the draft and clears submit state", () => {
    useTextSnippetsSectionStore.getState().patchEditorForm({ submitting: true, error: "stale" })
    useTextSnippetsSectionStore.getState().resetEditorForm("pgm", "pull request green then merge")

    expect(useTextSnippetsSectionStore.getState().editorForm).toEqual({
      shortcut: "pgm",
      expansion: "pull request green then merge",
      submitting: false,
      error: null,
    })
  })

  test("patchEditorForm merges without disturbing untouched fields", () => {
    useTextSnippetsSectionStore.getState().resetEditorForm("pgm", "expand me")
    useTextSnippetsSectionStore.getState().patchEditorForm({ expansion: "expanded" })

    const form = useTextSnippetsSectionStore.getState().editorForm
    expect(form.shortcut).toBe("pgm")
    expect(form.expansion).toBe("expanded")
    expect(form.error).toBeNull()
  })

  test("an error patch survives until the next reset", () => {
    useTextSnippetsSectionStore.getState().patchEditorForm({ error: "disk full" })
    useTextSnippetsSectionStore.getState().patchEditorForm({ submitting: false })
    expect(useTextSnippetsSectionStore.getState().editorForm.error).toBe("disk full")

    useTextSnippetsSectionStore.getState().resetEditorForm("", "")
    expect(useTextSnippetsSectionStore.getState().editorForm.error).toBeNull()
  })
})
