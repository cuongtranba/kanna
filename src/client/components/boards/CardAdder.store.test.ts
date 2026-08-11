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

  /**
   * The reason this is keyed rather than a single slot: a reader can start
   * typing in one column, look away, and add a card in another. A shared draft
   * would move their half-typed title to the wrong column.
   */
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
