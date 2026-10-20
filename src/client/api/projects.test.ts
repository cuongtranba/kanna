import { describe, expect, test } from "bun:test"
import { fetchProjectPaths } from "./projects"
import { makeFakeCommandPort } from "../adapters/testing/makeFakePorts"
import type { JsonValue } from "../../shared/json"

describe("fetchProjectPaths", () => {
  test("asks the project.listPaths command and returns the paths it answers with", async () => {
    const paths = [
      { path: "src/index.ts", kind: "file" as const },
      { path: "src/", kind: "dir" as const },
    ]
    const commands = makeFakeCommandPort(() => ({ paths }))

    const result = await fetchProjectPaths(commands, "proj1", "src")

    expect(result).toEqual(paths)
    expect(commands.calls).toEqual([{ type: "project.listPaths", projectId: "proj1", query: "src" }])
  })

  test("drops entries that are not a path with a file or dir kind", async () => {
    const reply: JsonValue = {
      paths: [{ path: "a.ts", kind: "file" }, { path: "b", kind: "symlink" }, { kind: "dir" }, "c"],
    }
    const commands = makeFakeCommandPort(() => reply)

    expect(await fetchProjectPaths(commands, "proj1", "")).toEqual([{ path: "a.ts", kind: "file" }])
  })

  test("returns an empty list when no socket is connected yet", async () => {
    expect(await fetchProjectPaths(null, "proj1", "x")).toEqual([])
  })

  test("lets a rejected command surface so the typeahead can report it", async () => {
    const commands = makeFakeCommandPort(() => {
      throw new Error("Project not found")
    })

    await expect(fetchProjectPaths(commands, "gone", "x")).rejects.toThrow("Project not found")
  })
})
