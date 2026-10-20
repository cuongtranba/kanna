import { isPlainObject } from "../shared/settings/plain-object"
import {
  SERVICE_BUS_DEFAULTS,
  serviceBusTokenHint,
  validateServiceBusSettings,
  type ConsumerAckPolicy,
  type ConsumerDeliverPolicy,
  type EmbeddedLogLevel,
  type EmbeddedServerSettings,
  type JetStreamConsumerSettings,
  type JetStreamStreamSettings,
  type ServiceBusMode,
  type ServiceBusSettingsPatch,
  type ServiceBusSettingsPublic,
  type ServiceBusSettingsStored,
  type StreamDiscard,
  type StreamRetention,
  type StreamStorage,
} from "../shared/service-bus/jetstream-config"

export type { ServiceBusSettingsStored }

export class ServiceBusSettingsError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid service bus settings: ${problems.join("; ")}`)
    this.name = "ServiceBusSettingsError"
  }
}

function readEnum<T, V extends string>(raw: T, allowed: readonly V[], fallback: V): V {
  return allowed.find((candidate) => Object.is(candidate, raw)) ?? fallback
}

function readString<T>(raw: T, fallback: string): string {
  return typeof raw === "string" ? raw : fallback
}

function readNumber<T>(raw: T, fallback: number): number {
  return typeof raw === "number" ? raw : fallback
}

function readStringList<T>(raw: T): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0)
}

function readPort<T>(raw: T, fallback: EmbeddedServerSettings["port"]): EmbeddedServerSettings["port"] {
  if (raw === "auto") return "auto"
  return typeof raw === "number" ? raw : fallback
}

const RETENTIONS: readonly StreamRetention[] = ["limits", "interest", "workqueue"]
const STORAGES: readonly StreamStorage[] = ["file", "memory"]
const DISCARDS: readonly StreamDiscard[] = ["old", "new"]
const ACK_POLICIES: readonly ConsumerAckPolicy[] = ["explicit", "none", "all"]
const DELIVER_POLICIES: readonly ConsumerDeliverPolicy[] = ["all", "new", "last"]
const MODES: readonly ServiceBusMode[] = ["embedded", "external"]
const LOG_LEVELS: readonly EmbeddedLogLevel[] = ["info", "debug"]

function readStream<T>(raw: T): JetStreamStreamSettings {
  const defaults = SERVICE_BUS_DEFAULTS.stream
  if (!isPlainObject(raw)) return { ...defaults, extraSubjects: [] }
  return {
    name: readString(raw.name, defaults.name).trim(),
    subjectPrefix: readString(raw.subjectPrefix, defaults.subjectPrefix).trim(),
    extraSubjects: readStringList(raw.extraSubjects),
    retention: readEnum(raw.retention, RETENTIONS, defaults.retention),
    storage: readEnum(raw.storage, STORAGES, defaults.storage),
    maxAgeDays: readNumber(raw.maxAgeDays, defaults.maxAgeDays),
    maxBytesMb: readNumber(raw.maxBytesMb, defaults.maxBytesMb),
    maxMsgs: readNumber(raw.maxMsgs, defaults.maxMsgs),
    discard: readEnum(raw.discard, DISCARDS, defaults.discard),
    duplicateWindowSec: readNumber(raw.duplicateWindowSec, defaults.duplicateWindowSec),
    replicas: readNumber(raw.replicas, defaults.replicas),
  }
}

function readConsumers<T>(raw: T): JetStreamConsumerSettings[] {
  if (!Array.isArray(raw)) return []
  const consumers: JetStreamConsumerSettings[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    consumers.push({
      durableName: readString(item.durableName, "").trim(),
      filterSubject: readString(item.filterSubject, "").trim(),
      ackPolicy: readEnum(item.ackPolicy, ACK_POLICIES, "explicit"),
      deliverPolicy: readEnum(item.deliverPolicy, DELIVER_POLICIES, "all"),
      maxAckPending: readNumber(item.maxAckPending, 1000),
      ackWaitSec: readNumber(item.ackWaitSec, 30),
    })
  }
  return consumers
}

function readEmbedded<T>(raw: T): EmbeddedServerSettings {
  const defaults = SERVICE_BUS_DEFAULTS.embedded
  if (!isPlainObject(raw)) return { ...defaults }
  return {
    maxMemoryStoreMb: readNumber(raw.maxMemoryStoreMb, defaults.maxMemoryStoreMb),
    maxFileStoreMb: readNumber(raw.maxFileStoreMb, defaults.maxFileStoreMb),
    port: readPort(raw.port, defaults.port),
    logLevel: readEnum(raw.logLevel, LOG_LEVELS, defaults.logLevel),
  }
}

function cleanToken(token: string | null | undefined): string | null {
  const trimmed = token?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

export function defaultServiceBusSettings(): ServiceBusSettingsStored {
  return {
    ...SERVICE_BUS_DEFAULTS,
    stream: { ...SERVICE_BUS_DEFAULTS.stream, extraSubjects: [] },
    consumers: [],
    embedded: { ...SERVICE_BUS_DEFAULTS.embedded },
    token: null,
  }
}

export function normalizeServiceBusSettings<T>(value: T, warnings: string[]): ServiceBusSettingsStored {
  if (value === undefined || value === null) return defaultServiceBusSettings()
  if (!isPlainObject(value)) {
    warnings.push("serviceBus must be an object")
    return defaultServiceBusSettings()
  }
  const token = cleanToken(typeof value.token === "string" ? value.token : null)
  const parsed: ServiceBusSettingsStored = {
    enabled: typeof value.enabled === "boolean" ? value.enabled : SERVICE_BUS_DEFAULTS.enabled,
    mode: readEnum(value.mode, MODES, SERVICE_BUS_DEFAULTS.mode),
    url: readString(value.url, SERVICE_BUS_DEFAULTS.url).trim(),
    stream: readStream(value.stream),
    consumers: readConsumers(value.consumers),
    embedded: readEmbedded(value.embedded),
    token,
  }
  const problems = validateServiceBusSettings(parsed)
  if (problems.length === 0) return parsed
  warnings.push(`serviceBus: reset to defaults (${problems.join("; ")})`)
  return { ...defaultServiceBusSettings(), token }
}

function nextToken(current: string | null, patch: string | null | undefined): string | null {
  if (patch === null) return null
  return cleanToken(patch) ?? current
}

export function applyServiceBusPatch(
  current: ServiceBusSettingsStored,
  patch: ServiceBusSettingsPatch | undefined,
): ServiceBusSettingsStored {
  if (patch === undefined) return current
  const stream = { ...current.stream, ...patch.stream }
  const next: ServiceBusSettingsStored = {
    enabled: patch.enabled ?? current.enabled,
    mode: patch.mode ?? current.mode,
    url: patch.url?.trim() ?? current.url,
    stream: { ...stream, name: stream.name.trim(), subjectPrefix: stream.subjectPrefix.trim(), extraSubjects: readStringList(stream.extraSubjects) },
    consumers: patch.consumers ?? current.consumers,
    embedded: { ...current.embedded, ...patch.embedded },
    token: nextToken(current.token, patch.token),
  }
  const problems = validateServiceBusSettings(next)
  if (problems.length > 0) throw new ServiceBusSettingsError(problems)
  return next
}

export function toPublicServiceBus({ token, ...rest }: ServiceBusSettingsStored): ServiceBusSettingsPublic {
  return { ...rest, tokenHint: token === null ? null : serviceBusTokenHint(token) }
}
