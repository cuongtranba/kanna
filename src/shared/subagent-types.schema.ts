import { z } from "zod"
import {
  SUBAGENT_CONTEXT_SCOPES,
  SUBAGENT_TRIGGER_MODES,
  type Subagent,
  type SubagentInput,
  type SubagentPatch,
  type SubagentValidationError,
} from "./subagent-types"
import type { SubagentCommandResult, SubagentDeleteResult } from "./protocol"
import { agentProviderSchema } from "./core-types.schema"
import {
  claudeModelOptionsSchema,
  codexModelOptionsSchema,
  openRouterModelOptionsSchema,
  strictPartialClaudeModelOptionsSchema,
  strictPartialCodexModelOptionsSchema,
} from "./provider-model-types.schema"
import { assertParity } from "./type-parity"

export const subagentContextScopeSchema = z.enum(SUBAGENT_CONTEXT_SCOPES)
export const subagentTriggerModeSchema = z.enum(SUBAGENT_TRIGGER_MODES)

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

const subagentModelOptionsSchema = z.union([claudeModelOptionsSchema, codexModelOptionsSchema, openRouterModelOptionsSchema])

export const subagentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  provider: agentProviderSchema,
  model: z.string(),
  modelOptions: subagentModelOptionsSchema,
  systemPrompt: z.string(),
  contextScope: subagentContextScopeSchema,
  triggerMode: subagentTriggerModeSchema,
  workingDir: z.string().optional(),
  allowedPaths: z.array(z.string()).optional(),
  maxTurns: z.number().optional(),
  allowBeaconTools: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const subagentValidationErrorSchema = z.object({
  code: z.enum([
    "EMPTY_NAME",
    "INVALID_CHAR",
    "RESERVED_NAME",
    "DUPLICATE_NAME",
    "TOO_LONG",
    "NOT_FOUND",
    "RESTRICTION_NOT_SUPPORTED",
    "INVALID_PATH",
    "PATH_ESCAPE",
    "EMPTY_ALLOWED_PATHS",
  ]),
  message: z.string(),
})

export const subagentCommandResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), subagent: subagentSchema }),
  z.object({ ok: z.literal(false), error: subagentValidationErrorSchema }),
])

export const subagentDeleteResultSchema = z.object({ ok: z.literal(true) })

assertParity<z.output<typeof subagentInputSchema>, SubagentInput>()
assertParity<z.output<typeof subagentPatchSchema>, SubagentPatch>()
assertParity<z.output<typeof subagentSchema>, Subagent>()
assertParity<z.output<typeof subagentValidationErrorSchema>, SubagentValidationError>()
assertParity<z.output<typeof subagentCommandResultSchema>, SubagentCommandResult>()
assertParity<z.output<typeof subagentDeleteResultSchema>, SubagentDeleteResult>()
