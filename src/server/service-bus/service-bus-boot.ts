import { randomBytes } from "node:crypto"
import { errorMessage } from "../../shared/errors"
import { log } from "../../shared/log"
import { DISABLED_SERVICE_BUS_STATUS, type ServiceBusSettingsStored, type ServiceBusStatus } from "../../shared/service-bus/jetstream-config"
import type { AppSettingsManager } from "../app-settings"
import type { EventStore } from "../event-store"
import { createBusTap } from "./event-store-tap"
import { createInMemoryServiceBus } from "./in-memory-service-bus"
import { installNatsServer } from "./nats-server-install.adapter"
import { createNatsServerProcess, resetNatsStore, type NatsProcessEvent, type NatsServerProcess } from "./nats-server-process.adapter"
import { createNatsMirror, type NatsEndpoint, type NatsMirror, type NatsMirrorOptions } from "./nats-mirror"
import { openNatsLink } from "./nats-service-bus.adapter"
import type { ServiceBus } from "./service-bus"

export type ServiceBusSettingsSource = Pick<AppSettingsManager, "getState" | "onChange" | "writePatch" | "getServiceBusCredential">

export interface ServiceBusParts {
  install: typeof installNatsServer
  createProcess: typeof createNatsServerProcess
  createMirror: (options: Omit<NatsMirrorOptions, "connect">) => NatsMirror
  resetStore: typeof resetNatsStore
}

export interface ServiceBusController {
  status: () => ServiceBusStatus
  subscribeStatus: (listener: () => void) => () => void
  resetStore: () => Promise<void>
  stop: () => Promise<void>
}

export interface StoreBus extends ServiceBus, ServiceBusController {
  attachMirror: (appSettings: ServiceBusSettingsSource, dataDir: string) => void
}

type Phase = "idle" | "installing" | "starting" | "running" | "restarting" | "failed"

const TOKEN_BYTES = 24

export const LIVE_SERVICE_BUS_PARTS: ServiceBusParts = {
  install: installNatsServer,
  createProcess: createNatsServerProcess,
  createMirror: (options) => createNatsMirror({ ...options, connect: openNatsLink }),
  resetStore: resetNatsStore,
}

function restartSignature(settings: ServiceBusSettingsStored): string {
  return JSON.stringify([settings.enabled, settings.mode, settings.url, settings.token, settings.embedded])
}

function reconcileSignature(settings: ServiceBusSettingsStored): string {
  return JSON.stringify([settings.stream, settings.consumers])
}

export function createServiceBusMirror(
  bus: ServiceBus,
  appSettings: ServiceBusSettingsSource,
  dataDir: string,
  platform: string,
  arch: string,
  parts: ServiceBusParts = LIVE_SERVICE_BUS_PARTS,
): ServiceBusController {
  const listeners = new Set<() => void>()
  let phase: Phase = "idle"
  let phaseError: string | null = null
  let serverVersion: string | undefined
  let natsProcess: NatsServerProcess | null = null
  let stopProcessEvents: (() => void) | null = null
  let endpoint: NatsEndpoint | null = null
  let work: Promise<void> = Promise.resolve()
  let activeRestart = ""
  let activeReconcile = ""
  let persistingToken = false

  const current = (): ServiceBusSettingsStored => ({ ...appSettings.getState().serviceBus })

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        log.warn("[service-bus] status listener failed:", errorMessage(error))
      }
    }
  }

  const mirror = parts.createMirror({
    getSettings: current,
    getEndpoint: () => endpoint,
    onStatus: notify,
  })
  bus.addMirror(mirror.sink)

  function status(): ServiceBusStatus {
    const settings = current()
    const base = mirror.status()
    const common = { ...base, mode: settings.mode, ...(serverVersion === undefined ? {} : { serverVersion }) }
    const port = natsProcess?.status().port ?? undefined
    const withPort = port === undefined || port === null ? common : { ...common, port }
    if (!settings.enabled) return { ...withPort, state: "disabled", lastError: null }
    if (phase === "installing") return { ...withPort, state: "installing" }
    if (phase === "starting") return { ...withPort, state: "starting" }
    if (phase === "restarting") return { ...withPort, state: "restarting", lastError: natsProcess?.status().lastError ?? base.lastError }
    if (phase === "failed") return { ...withPort, state: "error", lastError: phaseError }
    return withPort
  }

  function setPhase(next: Phase, error: string | null = null): void {
    phase = next
    phaseError = error
    notify()
  }

  function onProcessEvent(event: NatsProcessEvent): void {
    if (event.kind === "exited" || event.kind === "failed") setPhase("restarting")
    else setPhase("running")
  }

  async function ensureEmbeddedToken(settings: ServiceBusSettingsStored): Promise<string> {
    if (settings.token !== null) return settings.token
    const generated = randomBytes(TOKEN_BYTES).toString("base64url")
    persistingToken = true
    try {
      await appSettings.writePatch({ serviceBus: { token: generated } })
    } finally {
      persistingToken = false
    }
    return appSettings.getServiceBusCredential() ?? generated
  }

  async function startEmbedded(settings: ServiceBusSettingsStored): Promise<void> {
    const token = await ensureEmbeddedToken(settings)
    setPhase("installing")
    const installed = await parts.install({ dataDir, platform, arch })
    serverVersion = installed.version
    setPhase("starting")
    const server = parts.createProcess({ binaryPath: installed.binaryPath, dataDir, settings: settings.embedded, token })
    natsProcess = server
    stopProcessEvents = server.subscribe(onProcessEvent)
    const { port } = await server.start()
    endpoint = { url: `nats://127.0.0.1:${String(port)}`, token }
  }

  async function activate(): Promise<void> {
    const settings = current()
    activeRestart = restartSignature(settings)
    activeReconcile = reconcileSignature(settings)
    if (!settings.enabled) {
      setPhase("idle")
      return
    }
    try {
      if (settings.mode === "embedded") await startEmbedded(settings)
      else endpoint = { url: settings.url, token: settings.token }
      activeRestart = restartSignature(current())
      setPhase("running")
      void mirror.start()
    } catch (error) {
      log.warn("[service-bus] could not start:", errorMessage(error))
      setPhase("failed", errorMessage(error))
    }
  }

  async function deactivate(): Promise<void> {
    await mirror.stop()
    stopProcessEvents?.()
    stopProcessEvents = null
    const running = natsProcess
    natsProcess = null
    endpoint = null
    serverVersion = undefined
    if (running !== null) await running.stop().catch((error: Error) => log.warn("[service-bus] stop failed:", errorMessage(error)))
    setPhase("idle")
  }

  function enqueue(step: () => Promise<void>): Promise<void> {
    work = work.then(step).catch((error: Error) => {
      log.warn("[service-bus] step failed:", errorMessage(error))
    })
    return work
  }

  appSettings.onChange(() => {
    if (persistingToken) return
    const next = current()
    if (restartSignature(next) !== activeRestart) {
      void enqueue(async () => {
        await deactivate()
        await activate()
      })
    } else if (reconcileSignature(next) !== activeReconcile) {
      activeReconcile = reconcileSignature(next)
      void enqueue(() => mirror.reconcile())
    }
  })

  void enqueue(activate)

  return {
    status,
    subscribeStatus(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    resetStore() {
      if (current().mode !== "embedded") return Promise.reject(new Error("Reset store only applies to the embedded server"))
      return enqueue(async () => {
        await deactivate()
        await parts.resetStore(dataDir)
        await activate()
      })
    },
    stop() {
      return enqueue(deactivate)
    },
  }
}

export function createStoreBus(store: Pick<EventStore, "tap" | "getChat">): StoreBus {
  const memory = createInMemoryServiceBus()
  store.tap = createBusTap(memory, (chatId) => store.getChat(chatId)?.projectId, Date.now)
  let controller: ServiceBusController | null = null
  return {
    ...memory,
    attachMirror(appSettings, dataDir) {
      if (controller === null) controller = createServiceBusMirror(memory, appSettings, dataDir, process.platform, process.arch)
    },
    status: () => controller?.status() ?? DISABLED_SERVICE_BUS_STATUS,
    subscribeStatus: (listener) => controller?.subscribeStatus(listener) ?? (() => undefined),
    resetStore: () => controller?.resetStore() ?? Promise.resolve(),
    stop: () => controller?.stop() ?? Promise.resolve(),
  }
}
