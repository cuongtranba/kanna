import { beforeEach, describe, expect, test } from "bun:test"
import { useSlashCommandsStore } from "./slashCommandsStore"

describe("slashCommandsStore", () => {
  beforeEach(() => {
    useSlashCommandsStore.setState({ byProjectId: {} })
  })

  test("setForProject stores list", () => {
    useSlashCommandsStore.getState().setForProject("p1", [
      { name: "review", description: "r", argumentHint: "<pr>" },
    ])
    expect(useSlashCommandsStore.getState().byProjectId.p1).toEqual([
      { name: "review", description: "r", argumentHint: "<pr>" },
    ])
  })

  test("setForProject replaces existing list", () => {
    useSlashCommandsStore.getState().setForProject("p1", [{ name: "a", description: "", argumentHint: "" }])
    useSlashCommandsStore.getState().setForProject("p1", [{ name: "b", description: "", argumentHint: "" }])
    expect(useSlashCommandsStore.getState().byProjectId.p1).toEqual([
      { name: "b", description: "", argumentHint: "" },
    ])
  })

  // The whole point of keying by project: every chat in a project shares one
  // list, so opening a new chat renders on the first keystroke with no load.
  test("setForProject keeps entries for other projects", () => {
    useSlashCommandsStore.getState().setForProject("p1", [{ name: "a", description: "", argumentHint: "" }])
    useSlashCommandsStore.getState().setForProject("p2", [{ name: "b", description: "", argumentHint: "" }])
    expect(Object.keys(useSlashCommandsStore.getState().byProjectId).sort()).toEqual(["p1", "p2"])
    expect(useSlashCommandsStore.getState().byProjectId.p1).toEqual([
      { name: "a", description: "", argumentHint: "" },
    ])
  })

  test("clear removes only the named project", () => {
    useSlashCommandsStore.getState().setForProject("p1", [{ name: "x", description: "", argumentHint: "" }])
    useSlashCommandsStore.getState().setForProject("p2", [{ name: "y", description: "", argumentHint: "" }])
    useSlashCommandsStore.getState().clear("p1")
    expect(useSlashCommandsStore.getState().byProjectId.p1).toBeUndefined()
    expect(useSlashCommandsStore.getState().byProjectId.p2).toHaveLength(1)
  })

  test("clear on unknown project is a no-op", () => {
    const before = useSlashCommandsStore.getState().byProjectId
    useSlashCommandsStore.getState().clear("nope")
    expect(useSlashCommandsStore.getState().byProjectId).toBe(before)
  })
})
