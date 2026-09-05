import { beforeEach, describe, expect, test } from "bun:test"
import { selectCardDraft, useCardAdderStore } from "./CardAdder.store"

const state = () => useCardAdderStore.getState()

beforeEach(() => {
  useCardAdderStore.setState({ draftByColumn: {} })
})

describe("card adder drafts", () => {
  test("an untouched column has an empty field", () => {
    expect(selectCardDraft("col-1")(state())).toBe("")
  })

  test("each column keeps its own draft", () => {
    state().setDraft("col-1", "Fix login")
    state().setDraft("col-2", "Write docs")
    expect(selectCardDraft("col-1")(state())).toBe("Fix login")
    expect(selectCardDraft("col-2")(state())).toBe("Write docs")
  })

  test("clearing one column leaves the others alone", () => {
    state().setDraft("col-1", "Fix login")
    state().setDraft("col-2", "Write docs")
    state().clear("col-1")
    expect(selectCardDraft("col-1")(state())).toBe("")
    expect(selectCardDraft("col-2")(state())).toBe("Write docs")
  })

  test("clearing an untouched column changes nothing", () => {
    state().setDraft("col-1", "Fix login")
    const before = state()
    state().clear("col-2")
    expect(state()).toBe(before)
  })
})
