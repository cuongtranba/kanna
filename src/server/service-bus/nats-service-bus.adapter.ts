import { connect } from "@nats-io/transport-node"
import { jetstream, jetstreamManager, JetStreamApiCodes, JetStreamApiError, type JetStreamManager } from "@nats-io/jetstream"
import { errorMessage } from "../../shared/errors"
import type { WantedConsumerConfig, WantedStreamConfig } from "../../shared/service-bus/jetstream-config"
import type { JetStreamAdmin, LiveConsumer } from "./jetstream-reconcile"
import type { LinkState, LiveStatus, NatsConnector, NatsEndpoint, NatsLink } from "./nats-mirror"

export const RECONNECT_WAIT_MS = 2000
export const CLIENT_NAME = "kanna"

function adminOf(jsm: JetStreamManager): JetStreamAdmin {
  return {
    async streamInfo(name) {
      try {
        const info = await jsm.streams.info(name)
        return info.config
      } catch (error) {
        if (error instanceof JetStreamApiError && error.apiError().err_code === JetStreamApiCodes.StreamNotFound) return null
        throw error
      }
    },
    async streamAdd(config: WantedStreamConfig) {
      await jsm.streams.add(config)
    },
    async streamUpdate(config: WantedStreamConfig) {
      await jsm.streams.update(config.name, {
        subjects: config.subjects,
        max_age: config.max_age,
        max_bytes: config.max_bytes,
        max_msgs: config.max_msgs,
        discard: config.discard,
        duplicate_window: config.duplicate_window,
      })
    },
    async consumers(stream) {
      const found: LiveConsumer[] = []
      for await (const info of jsm.consumers.list(stream)) {
        found.push({ name: info.name, config: info.config, metadata: info.config.metadata ?? {} })
      }
      return found
    },
    async consumerAdd(stream, config: WantedConsumerConfig) {
      await jsm.consumers.add(stream, config)
    },
    async consumerUpdate(stream, config: WantedConsumerConfig) {
      await jsm.consumers.update(stream, config.durable_name, {
        filter_subject: config.filter_subject,
        max_ack_pending: config.max_ack_pending,
        ack_wait: config.ack_wait,
        metadata: config.metadata,
      })
    },
    async consumerDelete(stream, name) {
      await jsm.consumers.delete(stream, name)
    },
  }
}

async function readLiveStatus(jsm: JetStreamManager, stream: string, consumers: string[]): Promise<LiveStatus> {
  const info = await jsm.streams.info(stream)
  const live: LiveStatus = {
    stream: {
      name: stream,
      messages: info.state.messages,
      bytes: info.state.bytes,
      firstSeq: info.state.first_seq,
      lastSeq: info.state.last_seq,
    },
    consumers: [],
  }
  for (const name of consumers) {
    try {
      const consumer = await jsm.consumers.info(stream, name)
      live.consumers.push({
        name,
        pending: consumer.num_pending,
        ackPending: consumer.num_ack_pending,
        lastDelivered: consumer.delivered.stream_seq,
      })
    } catch {
      continue
    }
  }
  return live
}

export const openNatsLink: NatsConnector = async (endpoint: NatsEndpoint): Promise<NatsLink> => {
  const nc = await connect({
    servers: endpoint.url,
    ...(endpoint.token === null ? {} : { token: endpoint.token }),
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: RECONNECT_WAIT_MS,
    name: CLIENT_NAME,
  })
  let jsm: JetStreamManager
  try {
    jsm = await jetstreamManager(nc)
  } catch (error) {
    await nc.close().catch(() => undefined)
    throw new Error(`JetStream is not available on ${endpoint.url}: ${errorMessage(error)}`, { cause: error })
  }
  const js = jetstream(nc)
  const listeners: ((state: LinkState) => void)[] = []
  const notify = (state: LinkState): void => {
    for (const listener of listeners) listener(state)
  }

  void (async () => {
    for await (const event of nc.status()) {
      if (event.type === "disconnect" || event.type === "reconnecting") notify({ kind: "reconnecting" })
      else if (event.type === "reconnect") notify({ kind: "connected" })
    }
  })().catch(() => undefined)
  void nc.closed().then((closedWith) => {
    notify({ kind: "closed", message: closedWith instanceof Error ? closedWith.message : null })
  })

  return {
    async publish(subject, data, msgId, timeoutMs) {
      await js.publish(subject, data, { msgID: msgId, timeout: timeoutMs })
    },
    admin: adminOf(jsm),
    readStatus: (stream, consumers) => readLiveStatus(jsm, stream, consumers),
    onState: (listener) => {
      listeners.push(listener)
    },
    async close() {
      try {
        await nc.drain()
      } catch {
        await nc.close().catch(() => undefined)
      }
    },
  }
}
