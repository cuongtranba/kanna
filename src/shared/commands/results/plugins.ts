import { z } from "zod"

export const pluginRuntimeStateSchema = z.enum(["stopped", "starting", "running", "stopping", "crashed"])

export const pluginSummarySchema = z.object({
  id: z.string(),
  sourceDir: z.string(),
  enabled: z.boolean(),
  state: pluginRuntimeStateSchema,
})

export const pluginsListResultSchema = z.object({ plugins: z.array(pluginSummarySchema) })
