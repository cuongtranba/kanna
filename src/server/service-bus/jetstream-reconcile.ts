import {
  KANNA_MANAGED_METADATA_KEY,
  consumerNeedsUpdate,
  diffStreamConfig,
  toConsumerConfig,
  toStreamConfig,
  type LiveConsumerConfig,
  type LiveStreamConfig,
  type ServiceBusSettingsStored,
  type WantedConsumerConfig,
  type WantedStreamConfig,
} from "../../shared/service-bus/jetstream-config"

export interface LiveConsumer {
  name: string
  config: LiveConsumerConfig
  metadata: Record<string, string>
}

export interface JetStreamAdmin {
  streamInfo: (name: string) => Promise<LiveStreamConfig | null>
  streamAdd: (config: WantedStreamConfig) => Promise<void>
  streamUpdate: (config: WantedStreamConfig) => Promise<void>
  consumers: (stream: string) => Promise<LiveConsumer[]>
  consumerAdd: (stream: string, config: WantedConsumerConfig) => Promise<void>
  consumerUpdate: (stream: string, config: WantedConsumerConfig) => Promise<void>
  consumerDelete: (stream: string, name: string) => Promise<void>
}

export interface ReconcileOutcome {
  problems: string[]
}

async function reconcileStream(admin: JetStreamAdmin, wanted: WantedStreamConfig): Promise<string | null> {
  const live = await admin.streamInfo(wanted.name)
  if (live === null) {
    await admin.streamAdd(wanted)
    return null
  }
  const diff = diffStreamConfig(live, wanted)
  if (diff.recreateRequired.length > 0) {
    return `Stream ${wanted.name} must be recreated to change ${diff.recreateRequired.join(", ")}; Kanna never deletes a stream, so remove it yourself or restore the old value`
  }
  if (diff.changed) await admin.streamUpdate(wanted)
  return null
}

async function reconcileConsumers(admin: JetStreamAdmin, stream: string, wanted: WantedConsumerConfig[]): Promise<string[]> {
  const problems: string[] = []
  const live = await admin.consumers(stream)
  const wantedNames = new Set(wanted.map((consumer) => consumer.durable_name))
  for (const consumer of wanted) {
    try {
      const existing = live.find((candidate) => candidate.name === consumer.durable_name)
      if (existing === undefined) await admin.consumerAdd(stream, consumer)
      else if (existing.config.ack_policy !== consumer.ack_policy || existing.config.deliver_policy !== consumer.deliver_policy) {
        problems.push(`Consumer ${consumer.durable_name}: ack and deliver policy cannot change in place; remove the consumer and add it again`)
      } else if (consumerNeedsUpdate(existing.config, consumer)) await admin.consumerUpdate(stream, consumer)
    } catch (error) {
      problems.push(`Consumer ${consumer.durable_name}: ${error instanceof Error ? error.message : "failed"}`)
    }
  }
  for (const existing of live) {
    if (wantedNames.has(existing.name)) continue
    if (existing.metadata[KANNA_MANAGED_METADATA_KEY] !== "true") continue
    try {
      await admin.consumerDelete(stream, existing.name)
    } catch (error) {
      problems.push(`Consumer ${existing.name}: ${error instanceof Error ? error.message : "failed"}`)
    }
  }
  return problems
}

export async function reconcileJetStream(
  admin: JetStreamAdmin,
  settings: Pick<ServiceBusSettingsStored, "stream" | "consumers">,
): Promise<ReconcileOutcome> {
  const problems: string[] = []
  const streamProblem = await reconcileStream(admin, toStreamConfig(settings.stream))
  if (streamProblem !== null) problems.push(streamProblem)
  problems.push(
    ...(await reconcileConsumers(
      admin,
      settings.stream.name,
      settings.consumers.map((consumer) => toConsumerConfig(consumer, settings.stream.subjectPrefix)),
    )),
  )
  return { problems }
}
