import { beforeEach, describe, expect, test } from "bun:test"
import { useDiffCommitStore } from "./diffCommitStore"

const PROJECT = "project-1"
const PATHS = ["a.ts", "b.ts", "c.ts"]

function checked() {
  return useDiffCommitStore.getState().checkedPathsByProjectId[PROJECT]
}

describe("diffCommitStore", () => {
  beforeEach(() => {
    useDiffCommitStore.setState({ checkedPathsByProjectId: {} })
  })

  describe("toggleChecked", () => {
    test("flips a path without the caller reading its current value", () => {
      useDiffCommitStore.getState().reconcileProject(PROJECT, PATHS)
      expect(checked()?.["a.ts"]).toBe(true)

      useDiffCommitStore.getState().toggleChecked(PROJECT, "a.ts")
      expect(checked()?.["a.ts"]).toBe(false)

      useDiffCommitStore.getState().toggleChecked(PROJECT, "a.ts")
      expect(checked()?.["a.ts"]).toBe(true)
    })

    test("an unknown path defaults to checked, so toggling unchecks it", () => {
      useDiffCommitStore.getState().toggleChecked(PROJECT, "new.ts")
      expect(checked()?.["new.ts"]).toBe(false)
    })

    test("leaves sibling paths alone", () => {
      useDiffCommitStore.getState().reconcileProject(PROJECT, PATHS)
      useDiffCommitStore.getState().toggleChecked(PROJECT, "b.ts")

      expect(checked()?.["a.ts"]).toBe(true)
      expect(checked()?.["b.ts"]).toBe(false)
      expect(checked()?.["c.ts"]).toBe(true)
    })
  })

  describe("toggleAllChecked", () => {
    test("all selected -> clears everything", () => {
      useDiffCommitStore.getState().reconcileProject(PROJECT, PATHS)

      useDiffCommitStore.getState().toggleAllChecked(PROJECT, PATHS)

      expect(PATHS.every((p) => checked()?.[p] === false)).toBe(true)
    })

    test("none selected -> selects everything", () => {
      useDiffCommitStore.getState().reconcileProject(PROJECT, PATHS)
      useDiffCommitStore.getState().toggleAllChecked(PROJECT, PATHS)

      useDiffCommitStore.getState().toggleAllChecked(PROJECT, PATHS)

      expect(PATHS.every((p) => checked()?.[p] === true)).toBe(true)
    })

    test("partially selected -> selects everything (the mixed-state rule)", () => {
      useDiffCommitStore.getState().reconcileProject(PROJECT, PATHS)
      useDiffCommitStore.getState().toggleChecked(PROJECT, "b.ts")
      expect(checked()?.["b.ts"]).toBe(false)

      useDiffCommitStore.getState().toggleAllChecked(PROJECT, PATHS)

      expect(PATHS.every((p) => checked()?.[p] === true)).toBe(true)
    })

    test("an empty path list is a no-op", () => {
      useDiffCommitStore.getState().reconcileProject(PROJECT, PATHS)
      const before = useDiffCommitStore.getState()

      before.toggleAllChecked(PROJECT, [])

      expect(useDiffCommitStore.getState()).toBe(before)
    })
  })
})
