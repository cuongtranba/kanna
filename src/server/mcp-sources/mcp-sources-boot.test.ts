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
    callTool: async (sourceId, name) => `${sourceId}:${name}`,
    rememberKey: (sourceId, key) => { calls.push(`remember ${sourceId} ${key}`) },
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

  test("the runtime exposes the reply tool call and key memory of its runner", async () => {
    const { calls, runner, settings } = makeHarness()
    const runtime = runMcpSources(runner, settings, new Lifetime())

    expect(await runtime.callTool("s1", "send", {})).toBe("s1:send")
    runtime.rememberKey("s1", "k1")
    expect(calls).toContain("remember s1 k1")
  })
})
