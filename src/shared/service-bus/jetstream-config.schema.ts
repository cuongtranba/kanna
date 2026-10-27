import { z } from "zod"
import {
  CONSUMER_ACK_POLICIES,
  CONSUMER_DELIVER_POLICIES,
  EMBEDDED_LOG_LEVELS,
  SERVICE_BUS_MODES,
  STREAM_DISCARDS,
  STREAM_RETENTIONS,
  STREAM_STORAGES,
  type EmbeddedServerSettings,
  type JetStreamConsumerSettings,
  type JetStreamStreamSettings,
  type ServiceBusSettingsPatch,
  type ServiceBusSettingsPublic,
} from "./jetstream-config"
import { assertParity } from "../type-parity"

export const jetStreamStreamSettingsSchema = z.object({
  name: z.string(),
  subjectPrefix: z.string(),
  extraSubjects: z.array(z.string()),
  retention: z.enum(STREAM_RETENTIONS),
  storage: z.enum(STREAM_STORAGES),
  maxAgeDays: z.number(),
  maxBytesMb: z.number(),
  maxMsgs: z.number(),
  discard: z.enum(STREAM_DISCARDS),
  duplicateWindowSec: z.number(),
  replicas: z.number(),
})

export const jetStreamConsumerSettingsSchema = z.object({
  durableName: z.string(),
  filterSubject: z.string(),
  ackPolicy: z.enum(CONSUMER_ACK_POLICIES),
  deliverPolicy: z.enum(CONSUMER_DELIVER_POLICIES),
  maxAckPending: z.number(),
  ackWaitSec: z.number(),
})

export const embeddedServerSettingsSchema = z.object({
  maxMemoryStoreMb: z.number(),
  maxFileStoreMb: z.number(),
  port: z.union([z.literal("auto"), z.number()]),
  logLevel: z.enum(EMBEDDED_LOG_LEVELS),
})

const serviceBusModeSchema = z.enum(SERVICE_BUS_MODES)

export const serviceBusSettingsPublicSchema = z.object({
  enabled: z.boolean(),
  mode: serviceBusModeSchema,
  url: z.string(),
  stream: jetStreamStreamSettingsSchema,
  consumers: z.array(jetStreamConsumerSettingsSchema),
  embedded: embeddedServerSettingsSchema,
  tokenHint: z.string().nullable(),
})

export const serviceBusSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: serviceBusModeSchema.optional(),
  url: z.string().optional(),
  token: z.string().nullable().optional(),
  stream: jetStreamStreamSettingsSchema.partial().optional(),
  consumers: z.array(jetStreamConsumerSettingsSchema).optional(),
  embedded: embeddedServerSettingsSchema.partial().optional(),
})

assertParity<z.output<typeof jetStreamStreamSettingsSchema>, JetStreamStreamSettings>()
assertParity<z.output<typeof jetStreamConsumerSettingsSchema>, JetStreamConsumerSettings>()
assertParity<z.output<typeof embeddedServerSettingsSchema>, EmbeddedServerSettings>()
assertParity<z.output<typeof serviceBusSettingsPatchSchema>, ServiceBusSettingsPatch>()
assertParity<z.output<typeof serviceBusSettingsPublicSchema>, ServiceBusSettingsPublic>()
