import { describe, expect, test } from "bun:test"
import { createStore } from "zustand"
import { createBoardPaneUiState } from "./BoardPane.store"

function newPane() {
  return createStore(createBoardPaneUiState)
}

describe("one aside at a time", () => {
  const asides = ["openCardId", "syncPanelOpen", "schemaPanelOpen"] as const

  function openCount(pane: ReturnType<typeof newPane>): number {
    const state = pane.getState()
    return asides.filter((key) => state[key] !== null && state[key] !== false).length
  }

  test("opening the schema panel closes the sync panel and the drawer", () => {
    const pane = newPane()
    pane.getState().openSyncPanel()
    pane.getState().openCard("card-1")
    pane.getState().openSchemaPanel()

    expect(pane.getState().schemaPanelOpen).toBe(true)
    expect(openCount(pane)).toBe(1)
  })

  test("opening the sync panel or a card closes the schema panel", () => {
    const pane = newPane()
    pane.getState().openSchemaPanel()
    pane.getState().openSyncPanel()
    expect(pane.getState().schemaPanelOpen).toBe(false)
    expect(openCount(pane)).toBe(1)

    pane.getState().openSchemaPanel()
    pane.getState().openCard("card-1")
    expect(pane.getState().schemaPanelOpen).toBe(false)
    expect(openCount(pane)).toBe(1)
  })

  test("closing one leaves nothing open", () => {
    const pane = newPane()
    pane.getState().openSchemaPanel()
    pane.getState().closeSchemaPanel()
    expect(openCount(pane)).toBe(0)
  })
})

describe("two board panes do not share what is open", () => {
  test("opening a card in one pane leaves the other pane's drawer closed", () => {
    const left = newPane()
    const right = newPane()
    left.getState().openCard("card-1")
    left.getState().openSyncPanel()
    expect(right.getState().openCardId).toBeNull()
    expect(right.getState().syncPanelOpen).toBe(false)
  })
})

describe("the header message", () => {
  test("a failed command reports its message without ending a sync in flight", () => {
    const pane = newPane()
    pane.getState().startSync()
    pane.getState().reportMessage("column save failed")
    expect(pane.getState().syncing).toBe(true)
    expect(pane.getState().message).toBe("column save failed")
  })

  test("finishing a sync clears the spinner and shows the summary", () => {
    const pane = newPane()
    pane.getState().startSync()
    pane.getState().finishSync("Synced · 2 new, 0 updated")
    expect(pane.getState().syncing).toBe(false)
    expect(pane.getState().message).toBe("Synced · 2 new, 0 updated")
  })
})
