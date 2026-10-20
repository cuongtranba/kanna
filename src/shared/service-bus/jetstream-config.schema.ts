import { z } from "zod"
import type {
  EmbeddedServerSettings,
  JetStreamConsumerSettings,
  JetStreamStreamSettings,
  ServiceBusSettingsPatch,
} from "./jetstream-config"
import { assertParity } from "../type-parity"

export const jetStreamStreamSettingsSchema = z.object({
  name: z.string(),
  subjectPrefix: z.string(),
  extraSubjects: z.array(z.string()),
  retention: z.enum(["limits", "interest", "workqueue"]),
  storage: z.enum(["file", "memory"]),
  maxAgeDays: z.number(),
  maxBytesMb: z.number(),
  maxMsgs: z.number(),
  discard: z.enum(["old", "new"]),
  duplicateWindowSec: z.number(),
  replicas: z.number(),
})

export const jetStreamConsumerSettingsSchema = z.object({
  durableName: z.string(),
  filterSubject: z.string(),
  ackPolicy: z.enum(["explicit", "none", "all"]),
  deliverPolicy: z.enum(["all", "new", "last"]),
  maxAckPending: z.number(),
  ackWaitSec: z.number(),
})

export const embeddedServerSettingsSchema = z.object({
  maxMemoryStoreMb: z.number(),
  maxFileStoreMb: z.number(),
  port: z.union([z.literal("auto"), z.number()]),
  logLevel: z.enum(["info", "debug"]),
})

export const serviceBusSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["embedded", "external"]).optional(),
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
