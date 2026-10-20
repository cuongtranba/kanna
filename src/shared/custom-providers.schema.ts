import { z } from "zod"
import type { CustomProviderInput, CustomProviderModel, CustomProviderPatch } from "./custom-providers"
import { assertParity } from "./type-parity"

export const customProviderModelSchema = z.object({ id: z.string(), label: z.string() })

export const customProviderInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  baseUrl: z.string(),
  apiKey: z.string(),
  models: z.array(customProviderModelSchema),
  contextWindow: z.number().optional(),
})

export const customProviderPatchSchema = z.object({
  label: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  models: z.array(customProviderModelSchema).optional(),
  contextWindow: z.number().nullable().optional(),
})

assertParity<z.output<typeof customProviderModelSchema>, CustomProviderModel>()
assertParity<z.output<typeof customProviderInputSchema>, CustomProviderInput>()
assertParity<z.output<typeof customProviderPatchSchema>, CustomProviderPatch>()
