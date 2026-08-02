import { beforeEach, describe, expect, test } from "bun:test"
import { createStore, type StoreApi } from "zustand"
import {
  createSearchableModelPopoverState,
  type SearchableModelPopoverState,
} from "./SearchableModelPopover.store"

describe("SearchableModelPopover.store", () => {
  let store: StoreApi<SearchableModelPopoverState>

  beforeEach(() => {
    store = createStore<SearchableModelPopoverState>(createSearchableModelPopoverState())
  })

  test("starts closed with an empty query", () => {
    expect(store.getState().open).toBe(false)
    expect(store.getState().query).toBe("")
  })

  test("setPopoverOpen(true) opens without touching the query", () => {
    store.getState().setQuery("opus")
    store.getState().setPopoverOpen(true)

    expect(store.getState().open).toBe(true)
    expect(store.getState().query).toBe("opus")
  })

  test("setPopoverOpen(false) closes AND clears the query", () => {
    store.getState().setPopoverOpen(true)
    store.getState().setQuery("haiku")

    store.getState().setPopoverOpen(false)

    expect(store.getState().open).toBe(false)
    expect(store.getState().query).toBe("")
  })

  test("closeAndClearQuery matches setPopoverOpen(false)", () => {
    store.getState().setPopoverOpen(true)
    store.getState().setQuery("sonnet")

    store.getState().closeAndClearQuery()

    expect(store.getState().open).toBe(false)
    expect(store.getState().query).toBe("")
  })
})
