import { beforeEach, describe, expect, test } from "bun:test"
import { useSlashCommandsStore } from "../stores/slashCommandsStore"
import { selectSlashCommands, useSlashCommands } from "./useSlashCommands"

describe("useSlashCommands", () => {
  beforeEach(() => {
    useSlashCommandsStore.setState({ byProjectId: {} })
  })

  test("selector returns cached commands for a known project", () => {
    useSlashCommandsStore.getState().setForProject("p1", [
      { name: "review", description: "r", argumentHint: "<pr>" },
    ])
    const result = selectSlashCommands(useSlashCommandsStore.getState(), "p1")
    expect(result).toEqual([
      { name: "review", description: "r", argumentHint: "<pr>" },
    ])
  })

  // A fresh array per call would re-render the picker on every store tick
  // (React error #185); the selector must hand back one shared empty array.
  test("selector returns stable empty array for a missing projectId", () => {
    const state = useSlashCommandsStore.getState()
    const a = selectSlashCommands(state, "missing")
    const b = selectSlashCommands(state, "missing")
    expect(a).toBe(b)
  })

  test("selector returns stable empty array for null projectId", () => {
    const state = useSlashCommandsStore.getState()
    const a = selectSlashCommands(state, null)
    const b = selectSlashCommands(state, null)
    expect(a).toBe(b)
  })

  test("hook is exported as a function", () => {
    expect(useSlashCommands).toBeTypeOf("function")
  })
})
