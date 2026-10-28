import { beforeEach, describe, expect, test } from "vite-plus/test"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { clearCommandError, surfaceCommandError, surfaceErrorIn, withCommandFeedback } from "./commandFeedback"

beforeEach(() => {
  clearCommandError()
})

describe("command feedback", () => {
  test("both primitives clear a previous error on success and pass the value through", async () => {
    useKannaStateStore.getState().setCommandError("stale")
    expect(await withCommandFeedback(async () => 1)).toBe(1)
    expect(useKannaStateStore.getState().commandError).toBeNull()

    useKannaStateStore.getState().setCommandError("stale")
    expect(await surfaceCommandError(async () => 2)).toBe(2)
    expect(useKannaStateStore.getState().commandError).toBeNull()
  })

  test("withCommandFeedback reports and rethrows, surfaceCommandError reports and resolves undefined", async () => {
    await expect(withCommandFeedback(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(useKannaStateStore.getState().commandError).toBe("boom")

    clearCommandError()
    expect(await surfaceCommandError(async () => { throw new Error("bang") })).toBeUndefined()
    expect(useKannaStateStore.getState().commandError).toBe("bang")
  })

  test("surfaceErrorIn clears the local error first and reports a failure into it", async () => {
    const seen: (string | null)[] = []
    await surfaceErrorIn((message) => seen.push(message), async () => { throw new Error("nope") })
    expect(seen).toEqual([null, "nope"])
  })
})
