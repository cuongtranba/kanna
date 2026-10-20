import { z } from "zod"
import type { SubagentContextScope, SubagentInput, SubagentPatch, SubagentTriggerMode } from "./subagent-types"
import { agentProviderSchema } from "./core-types.schema"
import {
  claudeModelOptionsSchema,
  codexModelOptionsSchema,
  openRouterModelOptionsSchema,
  strictPartialClaudeModelOptionsSchema,
  strictPartialCodexModelOptionsSchema,
} from "./provider-model-types.schema"
import { assertParity } from "./type-parity"

export const subagentContextScopeSchema = z.enum(["previous-assistant-reply", "full-transcript"])
export const subagentTriggerModeSchema = z.enum(["auto", "manual"])

export const subagentInputSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  provider: agentProviderSchema,
  model: z.string(),
  modelOptions: z.union([claudeModelOptionsSchema, codexModelOptionsSchema, openRouterModelOptionsSchema]),
  systemPrompt: z.string(),
  contextScope: subagentContextScopeSchema,
  triggerMode: subagentTriggerModeSchema.optional(),
  workingDir: z.string().optional(),
  allowedPaths: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  allowBeaconTools: z.boolean().optional(),
})

export const subagentPatchSchema = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  provider: agentProviderSchema.optional(),
  model: z.string().optional(),
  modelOptions: z
    .union([strictPartialClaudeModelOptionsSchema, strictPartialCodexModelOptionsSchema, openRouterModelOptionsSchema])
    .optional(),
  systemPrompt: z.string().optional(),
  contextScope: subagentContextScopeSchema.optional(),
  triggerMode: subagentTriggerModeSchema.optional(),
  workingDir: z.string().nullable().optional(),
  allowedPaths: z.array(z.string()).nullable().optional(),
  maxTurns: z.number().nullable().optional(),
  allowBeaconTools: z.boolean().optional(),
})

assertParity<z.output<typeof subagentContextScopeSchema>, SubagentContextScope>()
assertParity<z.output<typeof subagentTriggerModeSchema>, SubagentTriggerMode>()
assertParity<z.output<typeof subagentInputSchema>, SubagentInput>()
assertParity<z.output<typeof subagentPatchSchema>, SubagentPatch>()
