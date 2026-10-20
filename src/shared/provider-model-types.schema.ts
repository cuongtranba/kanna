import { z } from "zod"
import type {
  ClaudeContextWindow,
  ClaudeModelOptions,
  ClaudeReasoningEffort,
  CodexModelOptions,
  ChatProviderPreferences,
  CodexReasoningEffort,
  CustomModelEntry,
  CustomModelInput,
  CustomModelPatch,
  ModelOptions,
  OpenRouterModel,
  OpenRouterModelOptions,
  ProviderContextWindowOption,
  TextSnippet,
  TextSnippetInput,
  TextSnippetPatch,
} from "./provider-model-types"
import { assertParity } from "./type-parity"

export const claudeReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"])
export const codexReasoningEffortSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"])
export const claudeContextWindowSchema = z.enum(["200k", "1m"])

export const claudeModelOptionsSchema = z.object({
  reasoningEffort: claudeReasoningEffortSchema,
  contextWindow: claudeContextWindowSchema,
})

export const codexModelOptionsSchema = z.object({
  reasoningEffort: codexReasoningEffortSchema,
  fastMode: z.boolean(),
})

export const openRouterModelOptionsSchema = z.record(z.string(), z.never())

const optionalSlotSchema = z.record(z.string(), z.never().optional())

export const partialClaudeModelOptionsSchema = claudeModelOptionsSchema.partial()
export const partialCodexModelOptionsSchema = codexModelOptionsSchema.partial()

export const strictPartialClaudeModelOptionsSchema = z.strictObject(partialClaudeModelOptionsSchema.shape)
export const strictPartialCodexModelOptionsSchema = z.strictObject(partialCodexModelOptionsSchema.shape)

export const modelOptionsSchema = z.object({
  claude: partialClaudeModelOptionsSchema.optional(),
  codex: partialCodexModelOptionsSchema.optional(),
  openrouter: optionalSlotSchema.optional(),
  custom: optionalSlotSchema.optional(),
})

export const providerContextWindowOptionSchema = z.object({
  id: claudeContextWindowSchema,
  label: z.string(),
})

const customModelProviderSchema = z.enum(["claude", "codex"])

export const customModelInputSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: customModelProviderSchema,
  supportedEfforts: z.array(claudeReasoningEffortSchema).readonly().optional(),
  aliases: z.array(z.string()).readonly().optional(),
  contextWindowOptions: z.array(providerContextWindowOptionSchema).readonly().optional(),
})

export const customModelEntrySchema = customModelInputSchema.extend({
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const openRouterModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextLength: z.number(),
  pricing: z.object({ promptPerTok: z.number(), completionPerTok: z.number() }).optional(),
})

function providerPreferenceSchema<M extends z.ZodType>(modelOptions: M) {
  return z.object({ model: z.string(), modelOptions, planMode: z.boolean() })
}

export const chatProviderPreferencesSchema = z.object({
  claude: providerPreferenceSchema(claudeModelOptionsSchema),
  codex: providerPreferenceSchema(codexModelOptionsSchema),
  openrouter: providerPreferenceSchema(openRouterModelOptionsSchema),
  custom: providerPreferenceSchema(openRouterModelOptionsSchema),
})

export const customModelPatchSchema = z.object({
  label: z.string().optional(),
  supportedEfforts: z.array(claudeReasoningEffortSchema).readonly().nullable().optional(),
  aliases: z.array(z.string()).readonly().nullable().optional(),
  contextWindowOptions: z.array(providerContextWindowOptionSchema).readonly().nullable().optional(),
})

export const textSnippetInputSchema = z.object({
  shortcut: z.string(),
  expansion: z.string(),
})

export const textSnippetSchema = textSnippetInputSchema.extend({
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const textSnippetPatchSchema = textSnippetInputSchema.partial()

assertParity<z.output<typeof claudeReasoningEffortSchema>, ClaudeReasoningEffort>()
assertParity<z.output<typeof codexReasoningEffortSchema>, CodexReasoningEffort>()
assertParity<z.output<typeof claudeContextWindowSchema>, ClaudeContextWindow>()
assertParity<z.output<typeof claudeModelOptionsSchema>, ClaudeModelOptions>()
assertParity<z.output<typeof codexModelOptionsSchema>, CodexModelOptions>()
assertParity<z.output<typeof openRouterModelOptionsSchema>, OpenRouterModelOptions>()
assertParity<z.output<typeof modelOptionsSchema>, ModelOptions>()
assertParity<z.output<typeof providerContextWindowOptionSchema>, ProviderContextWindowOption>()
assertParity<z.output<typeof customModelInputSchema>, CustomModelInput>()
assertParity<z.output<typeof customModelPatchSchema>, CustomModelPatch>()
assertParity<z.output<typeof textSnippetInputSchema>, TextSnippetInput>()
assertParity<z.output<typeof textSnippetPatchSchema>, TextSnippetPatch>()
assertParity<z.output<typeof customModelEntrySchema>, CustomModelEntry>()
assertParity<z.output<typeof openRouterModelSchema>, OpenRouterModel>()
assertParity<z.output<typeof chatProviderPreferencesSchema>, ChatProviderPreferences>()
assertParity<z.output<typeof textSnippetSchema>, TextSnippet>()
