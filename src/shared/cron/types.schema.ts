import { z } from "zod"
import { CRON_MODES, type CronField, type CronJobPatch, type CronSchedule } from "./types"
import { assertParity } from "../type-parity"

export const cronModeSchema = z.enum(CRON_MODES)

export const cronFieldSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }),
  z.object({ kind: z.literal("values"), values: z.array(z.number()).readonly() }),
])

export const cronScheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("cron"),
    expression: z.string(),
    second: cronFieldSchema.optional(),
    minute: cronFieldSchema,
    hour: cronFieldSchema,
    dom: cronFieldSchema,
    month: cronFieldSchema,
    dow: cronFieldSchema,
  }),
  z.object({ type: z.literal("interval"), ms: z.number() }),
])

export const cronJobPatchSchema = z.object({
  instruction: z.string().optional(),
  mode: cronModeSchema.optional(),
  schedule: cronScheduleSchema.optional(),
  scheduleText: z.string().optional(),
})

assertParity<z.output<typeof cronFieldSchema>, CronField>()
assertParity<z.output<typeof cronScheduleSchema>, CronSchedule>()
assertParity<z.output<typeof cronJobPatchSchema>, CronJobPatch>()
