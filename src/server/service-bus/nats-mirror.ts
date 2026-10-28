import { errorMessage } from "../../shared/errors"
import { log } from "../../shared/log"
import type { BusEnvelope } from "../../shared/service-bus/envelope"
import {
  subjectWithPrefix,
  type ServiceBusConsumerStatus,
  type ServiceBusSettingsStored,
  type ServiceBusState,
  type ServiceBusStatus,
  type ServiceBusStreamStatus,
} from "../../shared/service-bus/jetstream-config"
import { addCounter, BUS_MIRROR_DROPPED_TOTAL, BUS_PUBLISHED_TOTAL } from "../observability"
import { reconcileJetStream, type JetStreamAdmin } from "./jetstream-reconcile"
import { createMirrorQueue, type MirrorQueue } from "./nats-mirror-queue"
import { defaultSchedule, type NatsScheduler } from "./scheduler"
import type { BusSink } from "./service-bus"

export type LinkState = { kind: "connected" } | { kind: "reconnecting" } | { kind: "closed"; message: string | null }

export interface LiveStatus {
  stream?: ServiceBusStreamStatus
  consumers: ServiceBusConsumerStatus[]
}

export interface NatsLink {
  publish: (subject: string, data: Uint8Array, msgId: string, timeoutMs: number) => Promise<void>
  admin: JetStreamAdmin
  readStatus: (stream: string, consumers: string[]) => Promise<LiveStatus>
  onState: (listener: (state: LinkState) => void) => void
  close: () => Promise<void>
}

export interface NatsEndpoint {
  url: string
  token: string | null
}

export type NatsConnector = (endpoint: NatsEndpoint) => Promise<NatsLink>

export interface NatsMirrorOptions {
  getSettings: () => ServiceBusSettingsStored
  getEndpoint: () => NatsEndpoint | null
  onStatus: (status: ServiceBusStatus) => void
  connect: NatsConnector
  now?: () => number
  schedule?: NatsScheduler
}

export interface NatsMirror {
  sink: BusSink
  start: () => Promise<void>
  restart: () => Promise<void>
  stop: () => Promise<void>
  reconcile: () => Promise<void>
  status: () => ServiceBusStatus
}

export const PUBLISH_TIMEOUT_MS = 5000
export const CONNECT_RETRY_INITIAL_MS = 2000
export const CONNECT_RETRY_MAX_MS = 30_000
export const STATUS_REFRESH_MS = 30_000
export const WARN_THROTTLE_MS = 30_000
export const SHUTDOWN_FLUSH_MS = 2000

export function createNatsMirror(options: NatsMirrorOptions): NatsMirror {
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? defaultSchedule
  const queue: MirrorQueue = createMirrorQueue()
  const encoder = new TextEncoder()

  let running = false
  let generation = 0
  let link: NatsLink | null = null
  let linkUp = false
  let state: ServiceBusState = "disabled"
  let lastError: string | null = null
  let published = 0
  let since = now()
  let live: LiveStatus = { consumers: [] }
  let pumping = false
  let lastWarnAt = 0
  let cancelRefresh: (() => void) | null = null
  let wakeRetry: (() => void) | null = null

  function status(): ServiceBusStatus {
    return {
      state,
      mode: options.getSettings().mode,
      lastError,
      published,
      dropped: queue.dropped(),
      queued: queue.size(),
      ...(live.stream === undefined ? {} : { stream: live.stream }),
      consumers: live.consumers,
      since,
    }
  }

  function setState(next: ServiceBusState, error: string | null = lastError): void {
    if (next !== state) since = now()
    state = next
    lastError = error
    emit()
  }

  function emit(): void {
    try {
      options.onStatus(status())
    } catch (error) {
      log.warn("[nats-mirror] status listener failed:", errorMessage(error))
    }
  }

  function warnThrottled(message: string): void {
    if (now() - lastWarnAt < WARN_THROTTLE_MS) return
    lastWarnAt = now()
    log.warn("[nats-mirror]", message)
  }

  function drop(): void {
    queue.noteDropped()
    addCounter(BUS_MIRROR_DROPPED_TOTAL, 1)
  }

  async function pump(flushing = false): Promise<void> {
    if (pumping) return
    pumping = true
    try {
      while ((running || flushing) && linkUp && link !== null) {
        const item = queue.shift()
        if (item === undefined) return
        const prefix = options.getSettings().stream.subjectPrefix
        try {
          await link.publish(
            subjectWithPrefix(item.envelope.subject, prefix),
            encoder.encode(JSON.stringify(item.envelope)),
            item.envelope.idempotencyKey,
            PUBLISH_TIMEOUT_MS,
          )
          published += 1
          addCounter(BUS_PUBLISHED_TOTAL, 1, { sink: "nats" })
        } catch (error) {
          warnThrottled(`publish failed: ${errorMessage(error)}`)
          if (!queue.requeueHead(item)) drop()
        }
      }
    } finally {
      pumping = false
    }
  }

  async function refreshStatus(): Promise<void> {
    const current = link
    if (current === null || !linkUp) return
    const settings = options.getSettings()
    try {
      live = await current.readStatus(settings.stream.name, settings.consumers.map((consumer) => consumer.durableName))
    } catch (error) {
      warnThrottled(`status refresh failed: ${errorMessage(error)}`)
    }
  }

  function scheduleRefresh(): void {
    cancelRefresh?.()
    cancelRefresh = schedule(() => {
      cancelRefresh = null
      void (async () => {
        await refreshStatus()
        emit()
        if (running && linkUp) scheduleRefresh()
      })()
    }, STATUS_REFRESH_MS)
  }

  async function reconcile(): Promise<void> {
    const current = link
    if (current === null || !linkUp) return
    try {
      const outcome = await reconcileJetStream(current.admin, options.getSettings())
      await refreshStatus()
      if (outcome.problems.length > 0) setState("error", outcome.problems.join("; "))
      else setState("connected", null)
    } catch (error) {
      setState("error", errorMessage(error))
    }
  }

  async function afterConnected(): Promise<void> {
    await reconcile()
    scheduleRefresh()
    void pump()
  }

  function onLinkState(owner: NatsLink, ownerGeneration: number, next: LinkState): void {
    if (!running || generation !== ownerGeneration || link !== owner) return
    if (next.kind === "reconnecting") {
      linkUp = false
      setState("reconnecting")
      return
    }
    if (next.kind === "connected") {
      linkUp = true
      void afterConnected()
      return
    }
    linkUp = false
    link = null
    setState("error", next.message ?? "connection closed")
    void connectLoop(ownerGeneration)
  }

  function waitBeforeRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const cancel = schedule(resolve, delayMs)
      wakeRetry = () => {
        cancel()
        resolve()
      }
    })
  }

  async function connectLoop(ownerGeneration: number): Promise<void> {
    let delay = CONNECT_RETRY_INITIAL_MS
    while (running && generation === ownerGeneration) {
      const endpoint = options.getEndpoint()
      try {
        if (endpoint === null) throw new Error("no server address yet")
        if (state !== "error") setState("connecting")
        const opened = await options.connect(endpoint)
        if (!running || generation !== ownerGeneration) {
          await opened.close().catch(() => undefined)
          return
        }
        link = opened
        linkUp = true
        opened.onState((next) => {
          onLinkState(opened, ownerGeneration, next)
        })
        await afterConnected()
        return
      } catch (error) {
        setState("error", errorMessage(error))
        await waitBeforeRetry(delay)
        delay = Math.min(delay * 2, CONNECT_RETRY_MAX_MS)
      }
    }
  }

  async function shutdownLink(flush: boolean): Promise<void> {
    cancelRefresh?.()
    cancelRefresh = null
    wakeRetry?.()
    wakeRetry = null
    const closing = link
    link = null
    if (closing === null) {
      linkUp = false
      return
    }
    if (flush && linkUp && queue.size() > 0) {
      await Promise.race([pump(true), new Promise<void>((resolve) => schedule(resolve, SHUTDOWN_FLUSH_MS))])
    }
    linkUp = false
    await closing.close().catch((error: Error) => {
      log.warn("[nats-mirror] close failed:", errorMessage(error))
    })
  }

  async function stop(): Promise<void> {
    try {
      const wasRunning = running
      running = false
      generation += 1
      if (wasRunning) await shutdownLink(true)
      queue.clear()
      live = { consumers: [] }
      lastError = null
      setState("disabled")
    } catch (error) {
      log.warn("[nats-mirror] stop failed:", errorMessage(error))
    }
  }

  async function start(): Promise<void> {
    try {
      if (running) return
      running = true
      generation += 1
      lastError = null
      await connectLoop(generation)
    } catch (error) {
      setState("error", errorMessage(error))
    }
  }

  return {
    sink: {
      publish(envelope: BusEnvelope): void {
        try {
          if (!running) return
          queue.push(envelope)
          void pump()
        } catch (error) {
          warnThrottled(`enqueue failed: ${errorMessage(error)}`)
        }
      },
    },
    start,
    async restart() {
      await stop()
      void start()
    },
    stop,
    async reconcile() {
      try {
        await reconcile()
      } catch (error) {
        warnThrottled(`reconcile failed: ${errorMessage(error)}`)
      }
    },
    status,
  }
}
