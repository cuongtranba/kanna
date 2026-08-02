import { beforeEach, describe, expect, test } from "bun:test"
import { createStore, type StoreApi } from "zustand"
import { createMermaidZoomModalState, type MermaidZoomModalState } from "./MermaidZoomModal.store"

describe("MermaidZoomModal.store", () => {
  let store: StoreApi<MermaidZoomModalState>

  beforeEach(() => {
    store = createStore<MermaidZoomModalState>(createMermaidZoomModalState())
  })

  test("starts at 1x with no offset and no drag", () => {
    expect(store.getState().scale).toBe(1)
    expect(store.getState().offset).toEqual({ x: 0, y: 0 })
    expect(store.getState().drag).toBeNull()
  })

  test("zoomIn/zoomOut step by 0.25 without the caller reading the previous scale", () => {
    store.getState().zoomIn()
    expect(store.getState().scale).toBe(1.25)
    store.getState().zoomOut()
    store.getState().zoomOut()
    expect(store.getState().scale).toBe(0.75)
  })

  test("clamps zoom to [0.25, 8] inside the store", () => {
    for (let i = 0; i < 40; i++) store.getState().zoomIn()
    expect(store.getState().scale).toBe(8)

    for (let i = 0; i < 80; i++) store.getState().zoomOut()
    expect(store.getState().scale).toBe(0.25)
  })

  test("zoom is a no-op at the clamp boundary", () => {
    for (let i = 0; i < 40; i++) store.getState().zoomIn()
    const atMax = store.getState()
    atMax.zoomIn()
    expect(store.getState()).toBe(atMax)
  })

  test("resetView restores scale and offset in one action", () => {
    store.getState().zoomIn()
    store.getState().beginDrag(10, 10)
    store.getState().dragTo(60, 40)
    expect(store.getState().offset).not.toEqual({ x: 0, y: 0 })

    store.getState().resetView()

    expect(store.getState().scale).toBe(1)
    expect(store.getState().offset).toEqual({ x: 0, y: 0 })
  })

  test("beginDrag anchors on the current offset so dragTo yields an absolute offset", () => {
    store.getState().beginDrag(100, 50)
    store.getState().dragTo(130, 70)
    expect(store.getState().offset).toEqual({ x: 30, y: 20 })

    // a second gesture continues from where the first ended
    store.getState().endDrag()
    store.getState().beginDrag(0, 0)
    store.getState().dragTo(5, 5)
    expect(store.getState().offset).toEqual({ x: 35, y: 25 })
  })

  test("dragTo without an active drag is a no-op", () => {
    const initial = store.getState()
    initial.dragTo(999, 999)
    expect(store.getState()).toBe(initial)
  })

  test("endDrag clears the drag anchor but keeps the offset", () => {
    store.getState().beginDrag(0, 0)
    store.getState().dragTo(12, 8)
    store.getState().endDrag()

    expect(store.getState().drag).toBeNull()
    expect(store.getState().offset).toEqual({ x: 12, y: 8 })
  })
})
