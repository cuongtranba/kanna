import { beforeEach, describe, expect, test } from "bun:test"
import { useBoardSyncStore } from "./BoardPane.store"

beforeEach(() => {
  useBoardSyncStore.setState({ openCardId: null, syncPanelOpen: false, schemaPanelOpen: false })
})

/**
 * All three overlay the same columns, so a second one on top would hide the
 * board the reader is deciding about. Asserted here rather than trusted to the
 * markup because each opener is written independently.
 */
describe("one aside at a time", () => {
  const asides = ["openCardId", "syncPanelOpen", "schemaPanelOpen"] as const

  function openCount(): number {
    const state = useBoardSyncStore.getState()
    return asides.filter((key) => state[key] !== null && state[key] !== false).length
  }

  test("opening the schema panel closes the sync panel and the drawer", () => {
    useBoardSyncStore.getState().openSyncPanel()
    useBoardSyncStore.getState().openCard("card-1")
    useBoardSyncStore.getState().openSchemaPanel()

    expect(useBoardSyncStore.getState().schemaPanelOpen).toBe(true)
    expect(openCount()).toBe(1)
  })

  test("opening the sync panel or a card closes the schema panel", () => {
    useBoardSyncStore.getState().openSchemaPanel()
    useBoardSyncStore.getState().openSyncPanel()
    expect(useBoardSyncStore.getState().schemaPanelOpen).toBe(false)
    expect(openCount()).toBe(1)

    useBoardSyncStore.getState().openSchemaPanel()
    useBoardSyncStore.getState().openCard("card-1")
    expect(useBoardSyncStore.getState().schemaPanelOpen).toBe(false)
    expect(openCount()).toBe(1)
  })

  test("closing one leaves nothing open", () => {
    useBoardSyncStore.getState().openSchemaPanel()
    useBoardSyncStore.getState().closeSchemaPanel()
    expect(openCount()).toBe(0)
  })
})
