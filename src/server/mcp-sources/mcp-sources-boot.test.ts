import { describe, expect, test } from "vite-plus/test"
import { Lifetime } from "../lifetime"
import { runMcpSources, type McpSourceRunnerPort, type McpSourcesSettings } from "./mcp-sources-boot"

function makeHarness() {
  const calls: string[] = []
  const listeners = new Set<() => void>()
  const runner: McpSourceRunnerPort = {
    reconcile: async () => { calls.push("reconcile") },
    statuses: () => [],
    onStatus: () => () => {},
    stop: async () => { calls.push("runner.stop") },
  }
  const settings: McpSourcesSettings = {
    getSnapshot: () => ({ mcpSources: [], customMcpServers: [] }),
    onChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        calls.push("unsubscribe")
      }
    },
  }
  return { calls, listeners, runner, settings }
}

describe("runMcpSources", () => {
  test("reconciles at start and again on every settings change", () => {
    const { calls, listeners, runner, settings } = makeHarness()
    runMcpSources(runner, settings, new Lifetime())

    expect(calls).toEqual(["reconcile"])
    for (const listener of listeners) listener()
    expect(calls).toEqual(["reconcile", "reconcile"])
  })

  test("shutdown unsubscribes from settings and stops the runner", async () => {
    const { calls, listeners, runner, settings } = makeHarness()
    const lifetime = new Lifetime()
    runMcpSources(runner, settings, lifetime)

    await lifetime.disposeAll()

    expect(calls).toEqual(["reconcile", "unsubscribe", "runner.stop"])
    expect(listeners.size).toBe(0)
  })
})
