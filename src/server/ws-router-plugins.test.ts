import { describe, expect, test } from "bun:test"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import type { PluginService } from "./plugins/plugin-service"
import { handlePluginsCommand } from "./ws-router-plugins"

function fakeService(reloaded: string[]): PluginService {
  return {
    install: async () => {},
    list: () => [{ id: "hello", sourceDir: "/src/hello", enabled: true, state: "running" }],
    reload: async (id) => { reloaded.push(id) },
    clientBundle: async () => null,
    recordClientError: () => {},
    setEnabled: async () => {},
    restore: () => {},
    start: async () => {},
    status: (id) => (id === "hello" ? { state: "running" } : undefined),
    call: async () => ({ ok: true, output: null }),
    stop: async () => {},
    logs: () => [],
  }
}

async function run(command: ClientCommand, options: { enabled: boolean; reloaded?: string[] }): Promise<ServerEnvelope> {
  const sent: ServerEnvelope[] = []
  const service = fakeService(options.reloaded ?? [])
  const handled = await handlePluginsCommand(
    { enabled: () => options.enabled, service: () => service },
    (envelope) => { sent.push(envelope) },
    command,
    "request-1",
  )
  expect(handled).toBe(true)
  const [reply] = sent
  if (!reply) throw new Error("the handler claimed the command but sent nothing")
  return reply
}

describe("plugins.list", () => {
  test("answers what the plugin service reports while plugins are switched on", async () => {
    const reply = await run({ type: "plugins.list" }, { enabled: true })

    expect(reply).toEqual({
      v: 1,
      type: "ack",
      id: "request-1",
      result: { plugins: [{ id: "hello", sourceDir: "/src/hello", enabled: true, state: "running" }] },
    })
  })

  test("answers an empty list while plugins are switched off", async () => {
    const reply = await run({ type: "plugins.list" }, { enabled: false })

    expect(reply).toMatchObject({ type: "ack", result: { plugins: [] } })
  })
})

describe("plugins.reload", () => {
  test("restarts an installed plugin and acknowledges", async () => {
    const reloaded: string[] = []

    const reply = await run({ type: "plugins.reload", pluginId: "hello" }, { enabled: true, reloaded })

    expect(reply).toMatchObject({ type: "ack" })
    expect(reloaded).toEqual(["hello"])
  })

  test("refuses a plugin that is not installed, an invalid id, and a switched-off plugin system", async () => {
    const reloaded: string[] = []

    await expect(run({ type: "plugins.reload", pluginId: "ghost" }, { enabled: true, reloaded })).rejects.toThrow("not installed")
    await expect(run({ type: "plugins.reload", pluginId: "../etc" }, { enabled: true, reloaded })).rejects.toThrow("Invalid plugin id")
    await expect(run({ type: "plugins.reload", pluginId: "hello" }, { enabled: false, reloaded })).rejects.toThrow("switched off")
    expect(reloaded).toEqual([])
  })
})
