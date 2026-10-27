import { isRecord } from "../shared/errors"
import {
  CONSUMER_ACK_POLICIES,
  CONSUMER_DELIVER_POLICIES,
  EMBEDDED_LOG_LEVELS,
  SERVICE_BUS_CONSUMER_DEFAULTS,
  SERVICE_BUS_DEFAULTS,
  SERVICE_BUS_MODES,
  STREAM_DISCARDS,
  STREAM_RETENTIONS,
  STREAM_STORAGES,
  serviceBusTokenHint,
  validateServiceBusSettings,
  type EmbeddedServerSettings,
  type JetStreamConsumerSettings,
  type JetStreamStreamSettings,
  type ServiceBusSettingsPatch,
  type ServiceBusSettingsPublic,
  type ServiceBusSettingsStored,
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

function readStream<T>(raw: T): JetStreamStreamSettings {
  const defaults = SERVICE_BUS_DEFAULTS.stream
  if (!isRecord(raw)) return { ...defaults, extraSubjects: [] }
  return {
    name: readString(raw.name, defaults.name).trim(),
    subjectPrefix: readString(raw.subjectPrefix, defaults.subjectPrefix).trim(),
    extraSubjects: readStringList(raw.extraSubjects),
    retention: readEnum(raw.retention, STREAM_RETENTIONS, defaults.retention),
    storage: readEnum(raw.storage, STREAM_STORAGES, defaults.storage),
    maxAgeDays: readNumber(raw.maxAgeDays, defaults.maxAgeDays),
    maxBytesMb: readNumber(raw.maxBytesMb, defaults.maxBytesMb),
    maxMsgs: readNumber(raw.maxMsgs, defaults.maxMsgs),
    discard: readEnum(raw.discard, STREAM_DISCARDS, defaults.discard),
    duplicateWindowSec: readNumber(raw.duplicateWindowSec, defaults.duplicateWindowSec),
    replicas: readNumber(raw.replicas, defaults.replicas),
  }
}

function readConsumers<T>(raw: T): JetStreamConsumerSettings[] {
  if (!Array.isArray(raw)) return []
  const consumers: JetStreamConsumerSettings[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    consumers.push({
      durableName: readString(item.durableName, "").trim(),
      filterSubject: readString(item.filterSubject, "").trim(),
      ackPolicy: readEnum(item.ackPolicy, CONSUMER_ACK_POLICIES, SERVICE_BUS_CONSUMER_DEFAULTS.ackPolicy),
      deliverPolicy: readEnum(item.deliverPolicy, CONSUMER_DELIVER_POLICIES, SERVICE_BUS_CONSUMER_DEFAULTS.deliverPolicy),
      maxAckPending: readNumber(item.maxAckPending, SERVICE_BUS_CONSUMER_DEFAULTS.maxAckPending),
      ackWaitSec: readNumber(item.ackWaitSec, SERVICE_BUS_CONSUMER_DEFAULTS.ackWaitSec),
    })
  }
  return consumers
}

function readEmbedded<T>(raw: T): EmbeddedServerSettings {
  const defaults = SERVICE_BUS_DEFAULTS.embedded
  if (!isRecord(raw)) return { ...defaults }
  return {
    maxMemoryStoreMb: readNumber(raw.maxMemoryStoreMb, defaults.maxMemoryStoreMb),
    maxFileStoreMb: readNumber(raw.maxFileStoreMb, defaults.maxFileStoreMb),
    port: readPort(raw.port, defaults.port),
    logLevel: readEnum(raw.logLevel, EMBEDDED_LOG_LEVELS, defaults.logLevel),
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
  if (!isRecord(value)) {
    warnings.push("serviceBus must be an object")
    return defaultServiceBusSettings()
  }
  const token = cleanToken(typeof value.token === "string" ? value.token : null)
  const parsed: ServiceBusSettingsStored = {
    enabled: typeof value.enabled === "boolean" ? value.enabled : SERVICE_BUS_DEFAULTS.enabled,
    mode: readEnum(value.mode, SERVICE_BUS_MODES, SERVICE_BUS_DEFAULTS.mode),
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
