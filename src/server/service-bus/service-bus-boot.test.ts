import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ServiceBusStatus } from "../../shared/service-bus/jetstream-config"
import { AppSettingsManager } from "../app-settings"
import { createInMemoryServiceBus } from "./in-memory-service-bus"
import type { NatsMirror, NatsMirrorOptions } from "./nats-mirror"
import type { NatsProcessEvent, NatsServerProcessOptions } from "./nats-server-process.adapter"
import { createServiceBusMirror, type ServiceBusParts } from "./service-bus-boot"

let dirs: string[] = []
let managers: AppSettingsManager[] = []

afterEach(async () => {
  for (const manager of managers) manager.dispose()
  managers = []
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached")
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

function setup(options: { installFails?: boolean } = {}) {
  const calls: string[] = []
  const processOptions: NatsServerProcessOptions[] = []
  const mirrorOptions: NatsMirrorOptions[] = []
  let processListener: ((event: NatsProcessEvent) => void) | null = null
  const mirrorStatus: ServiceBusStatus = { state: "connected", mode: "embedded", lastError: null, published: 0, dropped: 0, queued: 0, consumers: [], since: 0 }

  const parts: ServiceBusParts = {
    install: async () => {
      calls.push("install")
      if (options.installFails) throw new Error("download failed")
      return { binaryPath: "/data/nats-server", version: "2.15.1", downloaded: true }
    },
    createProcess: (processOpts) => {
      processOptions.push(processOpts)
      return {
        start: async () => {
          calls.push("process.start")
          return { port: 50555 }
        },
        stop: async () => {
          calls.push("process.stop")
        },
        subscribe: (listener) => {
          processListener = listener
          return () => undefined
        },
        status: () => ({ state: "ready", port: 50555, restarts: 0, lastError: null }),
      }
    },
    createMirror: (mirrorOpts: Omit<NatsMirrorOptions, "connect">): NatsMirror => {
      mirrorOptions.push({ ...mirrorOpts, connect: async () => { throw new Error("unused") } })
      return {
        sink: { publish: () => undefined },
        start: async () => {
          calls.push("mirror.start")
        },
        restart: async () => undefined,
        stop: async () => {
          calls.push("mirror.stop")
        },
        reconcile: async () => {
          calls.push("mirror.reconcile")
        },
        status: () => mirrorStatus,
      }
    },
    resetStore: async () => {
      calls.push("resetStore")
    },
  }
  return { calls, parts, processOptions, mirrorOptions, emitProcess: (event: NatsProcessEvent) => processListener?.(event) }
}

async function settingsManager(): Promise<AppSettingsManager> {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-bus-boot-"))
  dirs.push(dir)
  const manager = new AppSettingsManager(path.join(dir, "settings.json"))
  managers.push(manager)
  await manager.initialize()
  return manager
}

describe("createServiceBusMirror", () => {
  test("does nothing while the bus is disabled", async () => {
    const harness = setup()
    const controller = createServiceBusMirror(createInMemoryServiceBus(), await settingsManager(), "/data", "darwin", "arm64", harness.parts)
    await controller.stop()

    expect(harness.calls).toEqual(["mirror.stop"])
    expect(controller.status().state).toBe("disabled")
  })

  test("in embedded mode generates and persists a token, installs, starts the server and points the mirror at it", async () => {
    const harness = setup()
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true } })
    const controller = createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)

    await until(() => harness.calls.includes("mirror.start"))

    expect(harness.calls).toEqual(["install", "process.start", "mirror.start"])
    const token = settings.getServiceBusCredential()
    expect(token?.length).toBeGreaterThan(20)
    expect(harness.processOptions[0]?.token).toBe(token ?? "")
    expect(harness.mirrorOptions[0]?.getEndpoint()).toEqual({ url: "nats://127.0.0.1:50555", token })
    expect(controller.status()).toMatchObject({ state: "connected", port: 50555, serverVersion: "2.15.1" })
  })

  test("in external mode uses the configured url and starts no server", async () => {
    const harness = setup()
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true, mode: "external", url: "nats://bus.local:4222", token: "external-token-1" } })
    createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)

    await until(() => harness.calls.includes("mirror.start"))

    expect(harness.calls).toEqual(["mirror.start"])
    expect(harness.mirrorOptions[0]?.getEndpoint()).toEqual({ url: "nats://bus.local:4222", token: "external-token-1" })
  })

  test("reports an install failure as an error status without throwing and without starting the mirror", async () => {
    const harness = setup({ installFails: true })
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true } })
    const controller = createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)

    await until(() => controller.status().state === "error")

    expect(controller.status().lastError).toBe("download failed")
    expect(harness.calls).toEqual(["install"])
  })

  test("a stream change reconciles in place, while a server change restarts everything", async () => {
    const harness = setup()
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true, mode: "external", url: "nats://a:4222" } })
    createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)
    await until(() => harness.calls.includes("mirror.start"))
    harness.calls.length = 0

    await settings.writePatch({ serviceBus: { stream: { maxAgeDays: 7 } } })
    await until(() => harness.calls.includes("mirror.reconcile"))
    expect(harness.calls).toEqual(["mirror.reconcile"])
    harness.calls.length = 0

    await settings.writePatch({ serviceBus: { url: "nats://b:4222" } })
    await until(() => harness.calls.includes("mirror.start"))
    expect(harness.calls).toEqual(["mirror.stop", "mirror.start"])
  })

  test("disabling stops the mirror and the embedded server", async () => {
    const harness = setup()
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true } })
    const controller = createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)
    await until(() => harness.calls.includes("mirror.start"))
    harness.calls.length = 0

    await settings.writePatch({ serviceBus: { enabled: false } })
    await until(() => harness.calls.includes("process.stop"))

    expect(harness.calls).toEqual(["mirror.stop", "process.stop"])
    expect(controller.status().state).toBe("disabled")
  })

  test("shows restarting while the embedded server is being restarted, then recovers", async () => {
    const harness = setup()
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true } })
    const controller = createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)
    await until(() => harness.calls.includes("mirror.start"))

    harness.emitProcess({ kind: "exited", code: 1, retryInMs: 1000 })
    expect(controller.status().state).toBe("restarting")
    harness.emitProcess({ kind: "ready", port: 50555, restart: true })
    expect(controller.status().state).toBe("connected")
  })

  test("reset store stops the server, wipes the store and starts again; it refuses in external mode", async () => {
    const harness = setup()
    const settings = await settingsManager()
    await settings.writePatch({ serviceBus: { enabled: true } })
    const controller = createServiceBusMirror(createInMemoryServiceBus(), settings, "/data", "darwin", "arm64", harness.parts)
    await until(() => harness.calls.includes("mirror.start"))
    harness.calls.length = 0

    await controller.resetStore()

    expect(harness.calls).toEqual(["mirror.stop", "process.stop", "resetStore", "install", "process.start", "mirror.start"])

    await settings.writePatch({ serviceBus: { mode: "external", url: "nats://a:4222" } })
    await until(() => controller.status().mode === "external")
    await expect(controller.resetStore()).rejects.toThrow("embedded")
  })
})
