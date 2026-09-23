import { beforeEach, describe, expect, test } from "bun:test"
import { useQuickSwitcherStore } from "./quickSwitcherStore"

beforeEach(() => {
  useQuickSwitcherStore.getState().closeSwitcher()
})

describe("quickSwitcherStore", () => {
  test("opens at the project step with an empty query", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    const state = useQuickSwitcherStore.getState()
    expect(state.open).toBe(true)
    expect(state.step).toBe("projects")
    expect(state.query).toBe("")
  })

  test("toggling closes an open switcher", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    useQuickSwitcherStore.getState().toggleSwitcher()
    expect(useQuickSwitcherStore.getState().open).toBe(false)
  })

  test("reopening discards the previous query and step", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    useQuickSwitcherStore.getState().setQuery("kanna")
    useQuickSwitcherStore.getState().drillIntoProject("p1", "kanna")
    useQuickSwitcherStore.getState().closeSwitcher()
    useQuickSwitcherStore.getState().openSwitcher()

    const state = useQuickSwitcherStore.getState()
    expect(state.step).toBe("projects")
    expect(state.query).toBe("")
    expect(state.projectId).toBeNull()
  })

  test("drilling into a project clears the query so sessions start unfiltered", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    useQuickSwitcherStore.getState().setQuery("kan")
    useQuickSwitcherStore.getState().drillIntoProject("p1", "kanna")

    const state = useQuickSwitcherStore.getState()
    expect(state.step).toBe("sessions")
    expect(state.projectId).toBe("p1")
    expect(state.projectName).toBe("kanna")
    expect(state.query).toBe("")
    expect(state.highlight).toBe(0)
  })

  test("going back returns to the project step and forgets the project", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    useQuickSwitcherStore.getState().drillIntoProject("p1", "kanna")
    useQuickSwitcherStore.getState().backToProjects()

    const state = useQuickSwitcherStore.getState()
    expect(state.step).toBe("projects")
    expect(state.projectId).toBeNull()
    expect(state.open).toBe(true)
  })

  test("typing resets the highlight to the best match", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    useQuickSwitcherStore.getState().setHighlight(3)
    useQuickSwitcherStore.getState().setQuery("a")
    expect(useQuickSwitcherStore.getState().highlight).toBe(0)
  })

  test("the highlight wraps at both ends of the list", () => {
    useQuickSwitcherStore.getState().openSwitcher()
    useQuickSwitcherStore.getState().moveHighlight(-1, 3)
    expect(useQuickSwitcherStore.getState().highlight).toBe(2)

    useQuickSwitcherStore.getState().moveHighlight(1, 3)
    expect(useQuickSwitcherStore.getState().highlight).toBe(0)
  })
})
