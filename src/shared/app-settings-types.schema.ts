import { z } from "zod"
import type {
  AppSettingsPatch,
  ClaudeAuthSettings,
  ClaudeLifecycleSettings,
  KeybindingsSnapshot,
  OAuthTokenEntry,
  PackageUpdateSettings,
  SubagentRuntimeSettings,
} from "./app-settings-types"
import { KEYBINDING_ACTIONS } from "./app-settings-types"
import {
  appThemePreferenceSchema,
  chatSoundIdSchema,
  chatSoundPreferenceSchema,
  defaultProviderPreferenceSchema,
  editorPresetSchema,
} from "./core-types.schema"
import {
  claudeModelOptionsSchema,
  codexModelOptionsSchema,
  customModelInputSchema,
  customModelPatchSchema,
  openRouterModelOptionsSchema,
  textSnippetInputSchema,
  textSnippetPatchSchema,
} from "./provider-model-types.schema"
import {
  authSettingsSchema,
  cloudflareTunnelSettingsSchema,
  installedPluginConfigSchema,
  pluginSettingsSchema,
  pushSettingsSchema,
  remoteMcpSettingsSchema,
  telemetrySettingsSchema,
  typographySettingsSchema,
  uploadSettingsSchema,
} from "./settings/settings.schema"
import { beaconPatchSchema, beaconScopeSchema } from "./beacon-config.schema"
import { customProviderInputSchema, customProviderPatchSchema } from "./custom-providers.schema"
import {
  mcpOAuthStateSchema,
  mcpServerInputSchema,
  mcpServerPatchSchema,
  mcpServerTestResultSchema,
} from "./mcp-types.schema"
import { mcpSourceInputSchema, mcpSourcePatchSchema } from "./mcp-sources/types.schema"
import { serviceBusSettingsPatchSchema } from "./service-bus/jetstream-config.schema"
import { subagentInputSchema, subagentPatchSchema } from "./subagent-types.schema"
import { assertParity } from "./type-parity"

const oauthTokenEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  token: z.string(),
  status: z.enum(["active", "limited", "error", "disabled"]),
  limitedUntil: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  lastErrorAt: z.number().nullable(),
  lastErrorMessage: z.string().nullable(),
  addedAt: z.number(),
  maxConcurrent: z.number().optional(),
  baseUrl: z.string().optional(),
})

export const claudeAuthSettingsSchema = z.object({
  tokens: z.array(oauthTokenEntrySchema),
  concurrencyDefault: z.number(),
})

export const keybindingsBindingsSchema = z.record(z.enum(KEYBINDING_ACTIONS), z.array(z.string()))

const claudeLifecycleSettingsSchema = z.object({ idleTimeoutMs: z.number(), maxConcurrent: z.number() })
const subagentRuntimeSettingsSchema = z.object({ runTimeoutMs: z.number(), defaultLoopSubagentId: z.string().nullable() })
const packageUpdateSettingsSchema = z.object({
  checkEnabled: z.boolean(),
  checkIntervalMs: z.number(),
  autoApply: z.boolean(),
  autoApplyKinds: z.array(z.enum(["skill", "claude-plugin", "codex-plugin"])),
  skillAgents: z.array(z.string()),
})

function providerPreferencePatch<M extends z.ZodType>(modelOptions: M) {
  return z.object({ model: z.string(), modelOptions, planMode: z.boolean() }).partial()
}

const idPatch = <P extends z.ZodType>(patch: P) => z.object({ id: z.string(), patch })
const idOnly = z.object({ id: z.string() })
const idEnabled = z.object({ id: z.string(), enabled: z.boolean() })

export const appSettingsPatchSchema = z.object({
  analyticsEnabled: z.boolean().optional(),
  browserSettingsMigrated: z.boolean().optional(),
  theme: appThemePreferenceSchema.optional(),
  typography: typographySettingsSchema.partial().optional(),
  chatSoundPreference: chatSoundPreferenceSchema.optional(),
  chatSoundId: chatSoundIdSchema.optional(),
  terminal: z.object({ scrollbackLines: z.number(), minColumnWidth: z.number() }).partial().optional(),
  panes: z.object({ tabMinWidth: z.number() }).partial().optional(),
  editor: z.object({ preset: editorPresetSchema, commandTemplate: z.string() }).partial().optional(),
  defaultProvider: defaultProviderPreferenceSchema.optional(),
  providerDefaults: z
    .object({
      claude: providerPreferencePatch(claudeModelOptionsSchema).optional(),
      codex: providerPreferencePatch(codexModelOptionsSchema).optional(),
      openrouter: providerPreferencePatch(openRouterModelOptionsSchema).optional(),
      custom: providerPreferencePatch(openRouterModelOptionsSchema).optional(),
    })
    .optional(),
  cloudflareTunnel: cloudflareTunnelSettingsSchema.partial().optional(),
  push: pushSettingsSchema.partial().optional(),
  telemetry: telemetrySettingsSchema.partial().optional(),
  auth: authSettingsSchema.partial().optional(),
  claudeAuth: claudeAuthSettingsSchema.partial().optional(),
  uploads: uploadSettingsSchema.partial().optional(),
  subagents: z
    .object({
      create: subagentInputSchema.optional(),
      update: idPatch(subagentPatchSchema).optional(),
      delete: idOnly.optional(),
    })
    .optional(),
  customMcpServers: z
    .object({
      create: mcpServerInputSchema.optional(),
      update: idPatch(mcpServerPatchSchema).optional(),
      delete: idOnly.optional(),
      setEnabled: idEnabled.optional(),
      setTestResult: z.object({ id: z.string(), result: mcpServerTestResultSchema }).optional(),
      setOAuthState: z.object({ id: z.string(), oauth: mcpOAuthStateSchema }).optional(),
    })
    .optional(),
  customBeacons: z
    .object({
      update: idPatch(beaconPatchSchema).optional(),
      delete: idOnly.optional(),
      setEnabled: idEnabled.optional(),
      setScope: z.object({ id: z.string(), scope: beaconScopeSchema }).optional(),
      addTrustedScript: z.object({ id: z.string(), hash: z.string() }).optional(),
      removeTrustedScript: z.object({ id: z.string(), hash: z.string() }).optional(),
    })
    .optional(),
  customModels: z
    .object({
      create: customModelInputSchema.optional(),
      update: idPatch(customModelPatchSchema).optional(),
      delete: idOnly.optional(),
    })
    .optional(),
  mcpSources: z
    .object({
      create: mcpSourceInputSchema.optional(),
      update: idPatch(mcpSourcePatchSchema).optional(),
      delete: idOnly.optional(),
      setEnabled: idEnabled.optional(),
    })
    .optional(),
  customProviders: z
    .object({
      create: customProviderInputSchema.optional(),
      update: idPatch(customProviderPatchSchema).optional(),
      delete: idOnly.optional(),
    })
    .optional(),
  textSnippets: z
    .object({
      create: textSnippetInputSchema.optional(),
      update: idPatch(textSnippetPatchSchema).optional(),
      delete: idOnly.optional(),
    })
    .optional(),
  claudeDriver: z.object({ lifecycle: claudeLifecycleSettingsSchema.partial().optional() }).optional(),
  globalPromptAppend: z.string().optional(),
  shareDefaultTtlHours: z.number().optional(),
  subagentRuntime: subagentRuntimeSettingsSchema.partial().optional(),
  packageUpdates: packageUpdateSettingsSchema.partial().optional(),
  plugins: pluginSettingsSchema.partial().optional(),
  remoteMcp: remoteMcpSettingsSchema.partial().optional(),
  serviceBus: serviceBusSettingsPatchSchema.optional(),
  installedPlugins: z
    .object({
      create: z.object({ sourceDir: z.string(), id: z.string() }).optional(),
      update: idPatch(installedPluginConfigSchema.pick({ enabled: true }).partial()).optional(),
      delete: idOnly.optional(),
    })
    .optional(),
})

assertParity<z.output<typeof claudeAuthSettingsSchema>, ClaudeAuthSettings>()
assertParity<z.output<typeof oauthTokenEntrySchema>, OAuthTokenEntry>()
assertParity<z.output<typeof keybindingsBindingsSchema>, KeybindingsSnapshot["bindings"]>()
assertParity<z.output<typeof claudeLifecycleSettingsSchema>, ClaudeLifecycleSettings>()
assertParity<z.output<typeof subagentRuntimeSettingsSchema>, SubagentRuntimeSettings>()
assertParity<z.output<typeof packageUpdateSettingsSchema>, PackageUpdateSettings>()
assertParity<z.output<typeof appSettingsPatchSchema>, AppSettingsPatch>()
