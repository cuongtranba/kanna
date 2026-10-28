import {
  SERVICE_BUS_CONSUMER_DEFAULTS,
  validateServiceBusSettings,
  type ConsumerAckPolicy,
  type ConsumerDeliverPolicy,
  type EmbeddedLogLevel,
  type EmbeddedServerSettings,
  type JetStreamConsumerSettings,
  type JetStreamStreamSettings,
  type RecreateField,
  type ServiceBusSettingsPublic,
  type StreamDiscard,
  type StreamRetention,
  type StreamStorage,
} from "../../shared/service-bus/jetstream-config"

export interface StreamDraft {
  name: string
  subjectPrefix: string
  extraSubjects: string
  retention: StreamRetention
  storage: StreamStorage
  maxAgeDays: string
  maxBytesMb: string
  maxMsgs: string
  discard: StreamDiscard
  duplicateWindowSec: string
  replicas: string
}

export interface ConsumerDraft {
  durableName: string
  filterSubject: string
  ackPolicy: ConsumerAckPolicy
  deliverPolicy: ConsumerDeliverPolicy
  maxAckPending: string
  ackWaitSec: string
}

export interface EmbeddedDraft {
  maxMemoryStoreMb: string
  maxFileStoreMb: string
  port: string
  logLevel: EmbeddedLogLevel
}

export interface ConnectionDraft {
  url: string
  token: string
}

export const AUTO_PORT = "auto"

export function streamToDraft(stream: JetStreamStreamSettings): StreamDraft {
  return {
    name: stream.name,
    subjectPrefix: stream.subjectPrefix,
    extraSubjects: stream.extraSubjects.join("\n"),
    retention: stream.retention,
    storage: stream.storage,
    maxAgeDays: String(stream.maxAgeDays),
    maxBytesMb: String(stream.maxBytesMb),
    maxMsgs: String(stream.maxMsgs),
    discard: stream.discard,
    duplicateWindowSec: String(stream.duplicateWindowSec),
    replicas: String(stream.replicas),
  }
}

function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text)
}

export function draftToStream(draft: StreamDraft): JetStreamStreamSettings {
  return {
    name: draft.name.trim(),
    subjectPrefix: draft.subjectPrefix.trim(),
    extraSubjects: draft.extraSubjects.split("\n").map((line) => line.trim()).filter((line) => line.length > 0),
    retention: draft.retention,
    storage: draft.storage,
    maxAgeDays: numberOf(draft.maxAgeDays),
    maxBytesMb: numberOf(draft.maxBytesMb),
    maxMsgs: numberOf(draft.maxMsgs),
    discard: draft.discard,
    duplicateWindowSec: numberOf(draft.duplicateWindowSec),
    replicas: numberOf(draft.replicas),
  }
}

export function consumerToDraft(consumer: JetStreamConsumerSettings): ConsumerDraft {
  return {
    durableName: consumer.durableName,
    filterSubject: consumer.filterSubject,
    ackPolicy: consumer.ackPolicy,
    deliverPolicy: consumer.deliverPolicy,
    maxAckPending: String(consumer.maxAckPending),
    ackWaitSec: String(consumer.ackWaitSec),
  }
}

export function newConsumerDraft(streamPrefix: string): ConsumerDraft {
  return {
    durableName: "",
    filterSubject: `${streamPrefix}.>`,
    ackPolicy: SERVICE_BUS_CONSUMER_DEFAULTS.ackPolicy,
    deliverPolicy: SERVICE_BUS_CONSUMER_DEFAULTS.deliverPolicy,
    maxAckPending: String(SERVICE_BUS_CONSUMER_DEFAULTS.maxAckPending),
    ackWaitSec: String(SERVICE_BUS_CONSUMER_DEFAULTS.ackWaitSec),
  }
}

export function draftToConsumer(draft: ConsumerDraft): JetStreamConsumerSettings {
  return {
    durableName: draft.durableName.trim(),
    filterSubject: draft.filterSubject.trim(),
    ackPolicy: draft.ackPolicy,
    deliverPolicy: draft.deliverPolicy,
    maxAckPending: numberOf(draft.maxAckPending),
    ackWaitSec: numberOf(draft.ackWaitSec),
  }
}

export function embeddedToDraft(embedded: EmbeddedServerSettings): EmbeddedDraft {
  return {
    maxMemoryStoreMb: String(embedded.maxMemoryStoreMb),
    maxFileStoreMb: String(embedded.maxFileStoreMb),
    port: String(embedded.port),
    logLevel: embedded.logLevel,
  }
}

export function draftToEmbedded(draft: EmbeddedDraft): EmbeddedServerSettings {
  const port = draft.port.trim().toLowerCase() === AUTO_PORT ? AUTO_PORT : numberOf(draft.port)
  return {
    maxMemoryStoreMb: numberOf(draft.maxMemoryStoreMb),
    maxFileStoreMb: numberOf(draft.maxFileStoreMb),
    port,
    logLevel: draft.logLevel,
  }
}

export function problemsOf(settings: ServiceBusSettingsPublic, patch: Partial<Pick<ServiceBusSettingsPublic, "url" | "stream" | "consumers" | "embedded">>): string[] {
  return validateServiceBusSettings({ ...settings, ...patch })
}

export function recreateFields(saved: JetStreamStreamSettings, next: JetStreamStreamSettings): RecreateField[] {
  const fields: RecreateField[] = []
  if (saved.retention !== next.retention) fields.push("retention")
  if (saved.storage !== next.storage) fields.push("storage")
  if (saved.replicas !== next.replicas) fields.push("replicas")
  return fields
}

export function lowersLimits(saved: JetStreamStreamSettings, next: JetStreamStreamSettings): boolean {
  return next.maxAgeDays < saved.maxAgeDays || next.maxBytesMb < saved.maxBytesMb
}

export function sameStream(saved: JetStreamStreamSettings, draft: StreamDraft): boolean {
  return JSON.stringify(streamToDraft(saved)) === JSON.stringify(draft)
}
