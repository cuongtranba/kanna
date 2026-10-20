import { BUS_SUBJECT_PREFIX } from "./envelope"

export type StreamRetention = "limits" | "interest" | "workqueue"
export type StreamStorage = "file" | "memory"
export type StreamDiscard = "old" | "new"
export type ConsumerAckPolicy = "explicit" | "none" | "all"
export type ConsumerDeliverPolicy = "all" | "new" | "last"
export type ServiceBusMode = "embedded" | "external"
export type EmbeddedLogLevel = "info" | "debug"

export interface JetStreamStreamSettings {
  name: string
  subjectPrefix: string
  extraSubjects: string[]
  retention: StreamRetention
  storage: StreamStorage
  maxAgeDays: number
  maxBytesMb: number
  maxMsgs: number
  discard: StreamDiscard
  duplicateWindowSec: number
  replicas: number
}

export interface JetStreamConsumerSettings {
  durableName: string
  filterSubject: string
  ackPolicy: ConsumerAckPolicy
  deliverPolicy: ConsumerDeliverPolicy
  maxAckPending: number
  ackWaitSec: number
}

export interface EmbeddedServerSettings {
  maxMemoryStoreMb: number
  maxFileStoreMb: number
  port: "auto" | number
  logLevel: EmbeddedLogLevel
}

export interface ServiceBusSettingsPublic {
  enabled: boolean
  mode: ServiceBusMode
  url: string
  stream: JetStreamStreamSettings
  consumers: JetStreamConsumerSettings[]
  embedded: EmbeddedServerSettings
  tokenHint: string | null
}

export interface ServiceBusSettingsStored {
  enabled: boolean
  mode: ServiceBusMode
  url: string
  stream: JetStreamStreamSettings
  consumers: JetStreamConsumerSettings[]
  embedded: EmbeddedServerSettings
  token: string | null
}

export interface ServiceBusSettingsPatch {
  enabled?: boolean
  mode?: ServiceBusMode
  url?: string
  token?: string | null
  stream?: Partial<JetStreamStreamSettings>
  consumers?: JetStreamConsumerSettings[]
  embedded?: Partial<EmbeddedServerSettings>
}

export type ServiceBusState =
  | "disabled"
  | "installing"
  | "starting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "restarting"
  | "error"

export interface ServiceBusStreamStatus {
  name: string
  messages: number
  bytes: number
  firstSeq: number
  lastSeq: number
}

export interface ServiceBusConsumerStatus {
  name: string
  pending: number
  ackPending: number
  lastDelivered?: number
}

export interface ServiceBusStatus {
  state: ServiceBusState
  mode: ServiceBusMode
  lastError: string | null
  serverVersion?: string
  port?: number
  published: number
  dropped: number
  queued: number
  stream?: ServiceBusStreamStatus
  consumers: ServiceBusConsumerStatus[]
  since: number
}

export const SERVICE_BUS_DEFAULTS: Omit<ServiceBusSettingsStored, "token"> = {
  enabled: false,
  mode: "embedded",
  url: "nats://127.0.0.1:4222",
  stream: {
    name: "KANNA",
    subjectPrefix: "kanna",
    extraSubjects: [],
    retention: "limits",
    storage: "file",
    maxAgeDays: 30,
    maxBytesMb: 512,
    maxMsgs: -1,
    discard: "old",
    duplicateWindowSec: 120,
    replicas: 1,
  },
  consumers: [],
  embedded: { maxMemoryStoreMb: 256, maxFileStoreMb: 2048, port: "auto", logLevel: "info" },
}

export const SERVICE_BUS_PORT_MIN = 1024
export const SERVICE_BUS_PORT_MAX = 65535
export const SERVICE_BUS_TOKEN_HINT_LENGTH = 4
export const SERVICE_BUS_TOKEN_HINT_MIN_LENGTH = 8
export const MAX_AGE_DAYS_RANGE = { min: 1, max: 3650 } as const
export const MAX_BYTES_MB_RANGE = { min: 1, max: 1_048_576 } as const
export const DUPLICATE_WINDOW_SEC_RANGE = { min: 0, max: 7200 } as const
export const REPLICAS_RANGE = { min: 1, max: 5 } as const
export const ACK_WAIT_SEC_RANGE = { min: 1, max: 3600 } as const
export const MAX_ACK_PENDING_RANGE = { min: 1, max: 1_000_000 } as const
export const EMBEDDED_STORE_MB_RANGE = { min: 16, max: 1_048_576 } as const

const NANOS_PER_SECOND = 1_000_000_000
const SECONDS_PER_DAY = 86_400
const BYTES_PER_MB = 1_048_576
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const PREFIX_PATTERN = /^[a-z][a-z0-9_-]*$/
const LITERAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/
const SERVER_URL_PATTERN = /^(?:nats|tls|ws|wss):\/\/[^\s/]+$/

export function serviceBusTokenHint(token: string): string | null {
  if (token.length < SERVICE_BUS_TOKEN_HINT_MIN_LENGTH) return null
  return token.slice(-SERVICE_BUS_TOKEN_HINT_LENGTH)
}

export function isValidSubjectPattern(subject: string): boolean {
  const tokens = subject.split(".")
  return tokens.every((token, index) => {
    if (token === ">") return index === tokens.length - 1
    return token === "*" || LITERAL_TOKEN_PATTERN.test(token)
  })
}

export function streamSubjects(stream: JetStreamStreamSettings): string[] {
  return [`${stream.subjectPrefix}.>`, ...stream.extraSubjects]
}

export interface WantedStreamConfig {
  name: string
  subjects: string[]
  retention: StreamRetention
  storage: StreamStorage
  max_age: number
  max_bytes: number
  max_msgs: number
  discard: StreamDiscard
  duplicate_window: number
  num_replicas: number
}

export function toStreamConfig(stream: JetStreamStreamSettings): WantedStreamConfig {
  return {
    name: stream.name,
    subjects: streamSubjects(stream),
    retention: stream.retention,
    storage: stream.storage,
    max_age: stream.maxAgeDays * SECONDS_PER_DAY * NANOS_PER_SECOND,
    max_bytes: stream.maxBytesMb * BYTES_PER_MB,
    max_msgs: stream.maxMsgs,
    discard: stream.discard,
    duplicate_window: stream.duplicateWindowSec * NANOS_PER_SECOND,
    num_replicas: stream.replicas,
  }
}

export const KANNA_MANAGED_METADATA_KEY = "kanna-managed"

export interface WantedConsumerConfig {
  durable_name: string
  filter_subject: string
  ack_policy: ConsumerAckPolicy
  deliver_policy: ConsumerDeliverPolicy
  max_ack_pending: number
  ack_wait: number
  metadata: Record<string, string>
}

export function toConsumerConfig(consumer: JetStreamConsumerSettings, streamPrefix: string): WantedConsumerConfig {
  return {
    durable_name: consumer.durableName,
    filter_subject: consumer.filterSubject.length > 0 ? consumer.filterSubject : `${streamPrefix}.>`,
    ack_policy: consumer.ackPolicy,
    deliver_policy: consumer.deliverPolicy,
    max_ack_pending: consumer.maxAckPending,
    ack_wait: consumer.ackWaitSec * NANOS_PER_SECOND,
    metadata: { [KANNA_MANAGED_METADATA_KEY]: "true" },
  }
}

export interface LiveStreamConfig {
  subjects: string[]
  retention: string
  storage: string
  max_age: number
  max_bytes: number
  max_msgs: number
  discard: string
  duplicate_window: number
  num_replicas: number
}

export type RecreateField = "retention" | "storage" | "replicas"

export interface StreamConfigDiff {
  changed: boolean
  recreateRequired: RecreateField[]
}

function sameSubjects(live: readonly string[], wanted: readonly string[]): boolean {
  if (live.length !== wanted.length) return false
  const sortedLive = [...live].sort()
  const sortedWanted = [...wanted].sort()
  return sortedLive.every((subject, index) => subject === sortedWanted[index])
}

export function diffStreamConfig(live: LiveStreamConfig, wanted: WantedStreamConfig): StreamConfigDiff {
  const recreateRequired: RecreateField[] = []
  if (live.retention !== wanted.retention) recreateRequired.push("retention")
  if (live.storage !== wanted.storage) recreateRequired.push("storage")
  if (live.num_replicas !== wanted.num_replicas) recreateRequired.push("replicas")
  const updatable =
    !sameSubjects(live.subjects, wanted.subjects) ||
    live.max_age !== wanted.max_age ||
    live.max_bytes !== wanted.max_bytes ||
    live.max_msgs !== wanted.max_msgs ||
    live.discard !== wanted.discard ||
    live.duplicate_window !== wanted.duplicate_window
  return { changed: updatable || recreateRequired.length > 0, recreateRequired }
}

export interface LiveConsumerConfig {
  filter_subject?: string
  ack_policy: string
  deliver_policy: string
  max_ack_pending?: number
  ack_wait?: number
}

export function consumerNeedsUpdate(live: LiveConsumerConfig, wanted: WantedConsumerConfig): boolean {
  return (
    live.filter_subject !== wanted.filter_subject ||
    live.ack_policy !== wanted.ack_policy ||
    live.deliver_policy !== wanted.deliver_policy ||
    live.max_ack_pending !== wanted.max_ack_pending ||
    live.ack_wait !== wanted.ack_wait
  )
}

function inRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isInteger(value) && value >= range.min && value <= range.max
}

function validateStream(stream: JetStreamStreamSettings): string[] {
  const errors: string[] = []
  if (!NAME_PATTERN.test(stream.name)) errors.push("Stream name must be 1–64 letters, digits, - or _")
  if (!PREFIX_PATTERN.test(stream.subjectPrefix)) {
    errors.push("Subject prefix must start with a lowercase letter and use lowercase letters, digits, - or _")
  }
  for (const subject of stream.extraSubjects) {
    if (!isValidSubjectPattern(subject)) errors.push(`Extra subject "${subject}" is not a valid NATS subject`)
  }
  if (!inRange(stream.maxAgeDays, MAX_AGE_DAYS_RANGE)) errors.push("Max age must be 1–3650 days")
  if (!inRange(stream.maxBytesMb, MAX_BYTES_MB_RANGE)) errors.push("Max bytes must be 1–1048576 MB")
  if (!Number.isInteger(stream.maxMsgs) || (stream.maxMsgs !== -1 && stream.maxMsgs < 1)) {
    errors.push("Max messages must be -1 (unlimited) or at least 1")
  }
  if (!inRange(stream.duplicateWindowSec, DUPLICATE_WINDOW_SEC_RANGE)) errors.push("Duplicate window must be 0–7200 seconds")
  if (!inRange(stream.replicas, REPLICAS_RANGE)) errors.push("Replicas must be 1–5")
  return errors
}

function validateConsumers(consumers: readonly JetStreamConsumerSettings[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const consumer of consumers) {
    if (!NAME_PATTERN.test(consumer.durableName)) {
      errors.push(`Consumer name "${consumer.durableName}" must be 1–64 letters, digits, - or _`)
    }
    if (seen.has(consumer.durableName)) errors.push(`Consumer name "${consumer.durableName}" is used twice`)
    seen.add(consumer.durableName)
    if (consumer.filterSubject.length > 0 && !isValidSubjectPattern(consumer.filterSubject)) {
      errors.push(`Consumer "${consumer.durableName}" filter is not a valid NATS subject`)
    }
    if (!inRange(consumer.ackWaitSec, ACK_WAIT_SEC_RANGE)) errors.push(`Consumer "${consumer.durableName}" ack wait must be 1–3600 seconds`)
    if (!inRange(consumer.maxAckPending, MAX_ACK_PENDING_RANGE)) {
      errors.push(`Consumer "${consumer.durableName}" max ack pending must be 1–1000000`)
    }
  }
  return errors
}

function validateEmbedded(embedded: EmbeddedServerSettings): string[] {
  const errors: string[] = []
  if (!inRange(embedded.maxMemoryStoreMb, EMBEDDED_STORE_MB_RANGE)) errors.push("Memory store must be 16–1048576 MB")
  if (!inRange(embedded.maxFileStoreMb, EMBEDDED_STORE_MB_RANGE)) errors.push("File store must be 16–1048576 MB")
  if (embedded.port !== "auto" && !inRange(embedded.port, { min: SERVICE_BUS_PORT_MIN, max: SERVICE_BUS_PORT_MAX })) {
    errors.push("Port must be auto or 1024–65535")
  }
  return errors
}

export function validateServiceBusSettings(settings: Omit<ServiceBusSettingsStored, "token">): string[] {
  const errors = [
    ...validateStream(settings.stream),
    ...validateConsumers(settings.consumers),
    ...validateEmbedded(settings.embedded),
  ]
  if (settings.mode === "external" && !SERVER_URL_PATTERN.test(settings.url)) {
    errors.push("Server URL must look like nats://host:4222")
  }
  return errors
}

export interface NatsConfigInput {
  port: number
  storeDir: string
  token: string
  maxMemoryStoreBytes: number
  maxFileStoreBytes: number
  logLevel: EmbeddedLogLevel
  pidFile: string
}

function quoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`
}

export function renderNatsConfig(input: NatsConfigInput): string {
  return [
    `listen: 127.0.0.1:${String(input.port)}`,
    `pid_file: ${quoted(input.pidFile)}`,
    `debug: ${input.logLevel === "debug" ? "true" : "false"}`,
    "jetstream {",
    `  store_dir: ${quoted(input.storeDir)}`,
    `  max_memory_store: ${String(input.maxMemoryStoreBytes)}`,
    `  max_file_store: ${String(input.maxFileStoreBytes)}`,
    "}",
    "authorization {",
    `  token: ${quoted(input.token)}`,
    "}",
    "",
  ].join("\n")
}

export function embeddedStoreBytes(embedded: EmbeddedServerSettings): { memory: number; file: number } {
  return { memory: embedded.maxMemoryStoreMb * BYTES_PER_MB, file: embedded.maxFileStoreMb * BYTES_PER_MB }
}

export const SERVICE_BUS_PUBLIC_DEFAULTS: ServiceBusSettingsPublic = {
  ...SERVICE_BUS_DEFAULTS,
  tokenHint: null,
}

export function applyServiceBusPatchToPublic(
  current: ServiceBusSettingsPublic,
  patch: ServiceBusSettingsPatch | undefined,
): ServiceBusSettingsPublic {
  if (patch === undefined) return current
  const { token, ...rest } = patch
  const replacement = token?.trim() ?? ""
  const keptHint = replacement.length > 0 ? serviceBusTokenHint(replacement) : current.tokenHint
  const tokenHint = token === null ? null : keptHint
  return {
    ...current,
    ...rest,
    stream: { ...current.stream, ...patch.stream },
    consumers: patch.consumers ?? current.consumers,
    embedded: { ...current.embedded, ...patch.embedded },
    tokenHint,
  }
}

export function subjectWithPrefix(subject: string, streamPrefix: string): string {
  const [first, ...rest] = subject.split(".")
  if (first !== BUS_SUBJECT_PREFIX) return subject
  return [streamPrefix, ...rest].join(".")
}

export const DISABLED_SERVICE_BUS_STATUS: ServiceBusStatus = {
  state: "disabled",
  mode: "embedded",
  lastError: null,
  published: 0,
  dropped: 0,
  queued: 0,
  consumers: [],
  since: 0,
}
