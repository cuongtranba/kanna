import type {
  ClientCommand,
  ClientEnvelope,
  ServerEnvelope,
  SubscriptionTopic,
  TerminalEvent,
  TerminalSnapshot,
} from "../../shared/protocol"
import { LOG_PREFIX } from "../../shared/branding"
import { log } from "../../shared/log"
import type { AnyValue } from "../../shared/errors"
import { generateUUID } from "../lib/utils"
import { getStoredPushDeviceId } from "./pushClient"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"
import type { StoragePort } from "../ports/storagePort"
import type { WebSocketPort, WebSocketLike } from "../ports/webSocketPort"
import { domAdapter } from "../adapters/dom.adapter"
import { timerAdapter } from "../adapters/timer.adapter"
import { localStorageAdapter, sessionStorageAdapter } from "../adapters/storage.adapter"
import { webSocketAdapter } from "../adapters/websocket.adapter"

export interface KannaSocketPorts {
  dom?: DomPort
  timer?: TimerPort
  localStorage?: StoragePort
  sessionStorage?: StoragePort
  webSocket?: WebSocketPort
}

type SnapshotListener<T> = (value: T) => void
type EventListener<T> = (value: T) => void
export type SocketStatus = "connecting" | "connected" | "disconnected"
type StatusListener = (status: SocketStatus) => void

const STALE_CONNECTION_MS = 25_000
const HEARTBEAT_INTERVAL_MS = 15_000
const PING_TIMEOUT_MS = 4_000
const SEND_TO_STARTING_PROFILE_STORAGE_KEY = "kanna:profile-send-to-starting"

interface InternalSubscriptionEntry {
  topic: SubscriptionTopic
  listener(v: AnyValue): void
  eventListener?(v: AnyValue): void
}

export class KannaSocket {
  private readonly url: string
  private ws: WebSocketLike | null = null
  private started = false
  private reconnectTimer: number | null = null
  private reconnectDelayMs = 750
  private readonly subscriptions = new Map<string, InternalSubscriptionEntry>()
  private readonly pending = new Map<string, { resolve: (value: AnyValue) => void; reject: (reason?: AnyValue) => void }>()
  private readonly outboundQueue: ClientEnvelope[] = []
  private readonly statusListeners = new Set<StatusListener>()
  private heartbeatTimer: number | null = null
  private pingTimeoutTimer: number | null = null
  private pingPromise: Promise<void> | null = null
  private lastOpenAt = 0
  private lastMessageAt = 0
  private reconnectImmediatelyOnClose = false
  private serviceWorkerCleanup: (() => void) | null = null

  private readonly dom: DomPort
  private readonly timer: TimerPort
  private readonly localStore: StoragePort
  private readonly sessStore: StoragePort
  private readonly wsBridge: WebSocketPort

  private readonly handleWindowFocus = () => {
    void this.ensureHealthyConnection()
  }
  private readonly handleVisibilityChange = () => {
    if (this.dom.getVisibilityState() === "visible") {
      this.startHeartbeat()
      void this.ensureHealthyConnection()
      return
    }
    this.stopHeartbeat()
  }
  private readonly handleOnline = () => {
    void this.ensureHealthyConnection()
  }

  constructor(url: string, ports: KannaSocketPorts = {}) {
    this.url = url
    this.dom = ports.dom ?? domAdapter
    this.timer = ports.timer ?? timerAdapter
    this.localStore = ports.localStorage ?? localStorageAdapter
    this.sessStore = ports.sessionStorage ?? sessionStorageAdapter
    this.wsBridge = ports.webSocket ?? webSocketAdapter
  }

  start() {
    if (this.started) {
      return
    }
    this.started = true

    // Register service worker message handler via the DOM port.
    this.serviceWorkerCleanup = this.dom.addServiceWorkerMessageListener((event: MessageEvent) => {
      const data: { type?: string; url?: string } = event.data
      if (data?.type === "kanna.navigate" && typeof data.url === "string") {
        this.dom.setHref(data.url)
      }
    })

    this.dom.addWindowListener("focus", this.handleWindowFocus)
    this.dom.addWindowListener("online", this.handleOnline)
    this.dom.addDocumentListener("visibilitychange", this.handleVisibilityChange)
    this.connect()
  }

  dispose() {
    this.started = false
    if (this.reconnectTimer) {
      this.timer.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHeartbeat()
    this.clearPingState()
    if (this.serviceWorkerCleanup) {
      this.serviceWorkerCleanup()
      this.serviceWorkerCleanup = null
    }
    this.ws?.close()
    this.ws = null
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Socket disposed"))
    }
    this.pending.clear()
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener)
    listener(this.getStatus())
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  subscribe<TSnapshot, TEvent = never>(
    topic: SubscriptionTopic,
    listener: SnapshotListener<TSnapshot>,
    eventListener?: EventListener<TEvent>
  ) {
    const id = generateUUID()
    const entry: InternalSubscriptionEntry = {
      topic,
      listener,
      eventListener,
    }
    this.subscriptions.set(id, entry)
    this.enqueue({ v: 1, type: "subscribe", id, topic })
    return () => {
      this.subscriptions.delete(id)
      this.enqueue({ v: 1, type: "unsubscribe", id })
    }
  }

  subscribeTerminal(
    terminalId: string,
    handlers: {
      onSnapshot: SnapshotListener<TerminalSnapshot | null>
      onEvent?: EventListener<TerminalEvent>
    }
  ) {
    const id = generateUUID()
    const topic: SubscriptionTopic = { type: "terminal", terminalId }
    const entry: InternalSubscriptionEntry = {
      topic,
      listener: handlers.onSnapshot,
      eventListener: handlers.onEvent,
    }
    this.subscriptions.set(id, entry)
    this.enqueue({ v: 1, type: "subscribe", id, topic })
    return () => {
      this.subscriptions.delete(id)
      this.enqueue({ v: 1, type: "unsubscribe", id })
    }
  }

  command<TResult = AnyValue>(command: ClientCommand): Promise<TResult>
  command(command: ClientCommand): Promise<AnyValue> {
    const id = generateUUID()
    const envelope: ClientEnvelope = { v: 1, type: "command", id, command }
    return new Promise<AnyValue>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.enqueue(envelope)
    })
  }

  /**
   * Fire-and-forget: enqueues a push.setFocusedChat command without awaiting
   * an ack. Focus hints are advisory (the server suppresses notifications for
   * the focused chat); a lost or late hint is harmless, so we don't gate the
   * UI on a round-trip.
   */
  setFocusedChat(chatId: string | null) {
    const id = generateUUID()
    this.enqueue({
      v: 1,
      type: "command",
      id,
      command: { type: "push.setFocusedChat", chatId },
    })
  }

  ensureHealthyConnection() {
    const WS = this.wsBridge
    if (!this.ws || this.ws.readyState === WS.CLOSED || this.ws.readyState === WS.CLOSING) {
      this.reconnectNow()
      return Promise.resolve()
    }

    if (this.ws.readyState === WS.CONNECTING) {
      return Promise.resolve()
    }

    if (!this.isConnectionStale()) {
      return Promise.resolve()
    }

    return this.sendPing()
  }

  private isSendToStartingProfilingEnabled() {
    try {
      return this.sessStore.getItem(SEND_TO_STARTING_PROFILE_STORAGE_KEY) === "1"
        || this.localStore.getItem(SEND_TO_STARTING_PROFILE_STORAGE_KEY) === "1"
    } catch {
      return false
    }
  }

  private connect() {
    if (!this.started) {
      return
    }
    this.emitStatus("connecting")
    this.ws = this.wsBridge.create(this.url)

    this.ws.addEventListener("open", () => {
      this.reconnectDelayMs = 750
      this.reconnectImmediatelyOnClose = false
      this.lastOpenAt = Date.now()
      this.lastMessageAt = this.lastOpenAt
      this.emitStatus("connected")
      this.startHeartbeat()
      for (const [id, subscription] of this.subscriptions.entries()) {
        this.sendNow({ v: 1, type: "subscribe", id, topic: subscription.topic })
      }
      while (this.outboundQueue.length > 0) {
        const envelope = this.outboundQueue.shift()
        if (envelope) {
          this.sendNow(envelope)
        }
      }
      const pushDeviceId = getStoredPushDeviceId()
      if (pushDeviceId) {
        this.sendNow({
          v: 1,
          type: "command",
          id: generateUUID(),
          command: { type: "push.identifyDevice", pushDeviceId },
        })
      }
    })

    this.ws.addEventListener("message", (event) => {
      this.lastMessageAt = Date.now()
      const receivedAt = performance.now()
      const msgData = event instanceof MessageEvent ? event.data : undefined
      const rawText = String(msgData)
      let payload: ServerEnvelope
      try {
        payload = JSON.parse(rawText)
      } catch {
        return
      }

      if (this.isSendToStartingProfilingEnabled() && payload.type === "snapshot" && payload.snapshot.type === "chat" && payload.snapshot.data?.runtime.status === "starting") {
        log.debug("[kanna/send->starting][client-ws]", {
          stage: "socket_message_received",
          receivedAt,
          payloadBytes: rawText.length,
          chatId: payload.snapshot.data.runtime.chatId,
          status: payload.snapshot.data.runtime.status,
          messageCount: payload.snapshot.data.messages.length,
        })
      }

      if (this.isSendToStartingProfilingEnabled() && payload.type === "ack") {
        log.debug("[kanna/send->starting][client-ws]", {
          stage: "socket_ack_received",
          receivedAt,
          payloadBytes: rawText.length,
          commandId: payload.id,
        })
      }

      if (payload.type === "snapshot") {
        const subscription = this.subscriptions.get(payload.id)
        subscription?.listener(payload.snapshot.data)
        return
      }

      if (payload.type === "event") {
        const subscription = this.subscriptions.get(payload.id)
        subscription?.eventListener?.(payload.event)
        return
      }

      if (payload.type === "ack") {
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
        pending.resolve(payload.result)
        return
      }

      if (payload.type === "error") {
        if (!payload.id) {
          log.error(LOG_PREFIX, payload.message)
          return
        }
        const pending = this.pending.get(payload.id)
        if (!pending) return
        this.pending.delete(payload.id)
        pending.reject(new Error(payload.message))
      }
    })

    this.ws.addEventListener("close", () => {
      if (!this.started) {
        return
      }
      const reconnectImmediately = this.reconnectImmediatelyOnClose
      this.reconnectImmediatelyOnClose = false
      this.stopHeartbeat()
      this.clearPingState()
      this.emitStatus("disconnected")
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Disconnected"))
      }
      this.pending.clear()
      if (reconnectImmediately) {
        this.connect()
        return
      }
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = this.timer.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 5_000)
    }, this.reconnectDelayMs)
  }

  private getStatus(): SocketStatus {
    const WS = this.wsBridge
    if (this.ws?.readyState === WS.OPEN) {
      return "connected"
    }
    if (this.ws?.readyState === WS.CONNECTING) {
      return "connecting"
    }
    return "disconnected"
  }

  private emitStatus(status: SocketStatus) {
    for (const listener of this.statusListeners) {
      listener(status)
    }
  }

  private isConnectionStale() {
    const baseline = Math.max(this.lastMessageAt, this.lastOpenAt)
    return baseline > 0 && Date.now() - baseline >= STALE_CONNECTION_MS
  }

  private sendPing() {
    if (this.pingPromise) {
      return this.pingPromise
    }

    const pingPromise = this.command({ type: "system.ping" })
      .then(() => {
        this.clearPingState()
      })
      .catch((error) => {
        this.clearPingState()
        this.reconnectNow()
        throw error
      })

    this.pingTimeoutTimer = this.timer.setTimeout(() => {
      this.clearPingState()
      this.reconnectNow()
    }, PING_TIMEOUT_MS)

    this.pingPromise = pingPromise
    return pingPromise
  }

  private reconnectNow() {
    const WS = this.wsBridge
    if (this.reconnectTimer !== null) {
      this.timer.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (!this.ws || this.ws.readyState === WS.CLOSED) {
      this.connect()
      return
    }

    if (this.ws.readyState === WS.CONNECTING) {
      return
    }

    this.reconnectImmediatelyOnClose = true
    this.ws.close()
  }

  private startHeartbeat() {
    if (this.dom.getVisibilityState() !== "visible") {
      return
    }

    if (this.heartbeatTimer !== null) {
      return
    }

    this.heartbeatTimer = this.timer.setInterval(() => {
      if (this.dom.getVisibilityState() !== "visible") {
        this.stopHeartbeat()
        return
      }
      const WS = this.wsBridge
      if (this.ws?.readyState !== WS.OPEN) {
        return
      }
      void this.ensureHealthyConnection()
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      this.timer.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearPingState() {
    if (this.pingTimeoutTimer !== null) {
      this.timer.clearTimeout(this.pingTimeoutTimer)
      this.pingTimeoutTimer = null
    }
    this.pingPromise = null
  }

  private enqueue(envelope: ClientEnvelope) {
    const WS = this.wsBridge
    if (this.ws?.readyState === WS.OPEN) {
      this.sendNow(envelope)
      return
    }
    this.outboundQueue.push(envelope)
  }

  private sendNow(envelope: ClientEnvelope) {
    this.ws?.send(JSON.stringify(envelope))
  }
}
