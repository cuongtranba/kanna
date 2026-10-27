import { z } from "zod"
import type {
  AppSettingsPatch,
  AppSettingsSnapshot,
  ClaudeAuthSettings,
  ClaudeDriverSettings,
  ClaudeLifecycleSettings,
  KeybindingsSnapshot,
  OAuthTokenEntry,
  PackageUpdateSettings,
  SubagentRuntimeSettings,
} from "./app-settings-types"
import { KEYBINDING_ACTIONS } from "./app-settings-types"
import { PACKAGE_KINDS } from "./packages/types"
import {
  appThemePreferenceSchema,
  chatSoundIdSchema,
  chatSoundPreferenceSchema,
  defaultProviderPreferenceSchema,
  editorPresetSchema,
} from "./core-types.schema"
import {
  chatProviderPreferencesSchema,
  claudeModelOptionsSchema,
  codexModelOptionsSchema,
  customModelEntrySchema,
  customModelInputSchema,
  customModelPatchSchema,
  openRouterModelOptionsSchema,
  textSnippetInputSchema,
  textSnippetPatchSchema,
  textSnippetSchema,
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
import { beaconConfigSchema, beaconPatchSchema, beaconScopeSchema } from "./beacon-config.schema"
import { customProviderInputSchema, customProviderPatchSchema, customProviderPublicSchema } from "./custom-providers.schema"
import {
  mcpOAuthStateSchema,
  mcpServerConfigSchema,
  mcpServerInputSchema,
  mcpServerPatchSchema,
  mcpServerTestResultSchema,
} from "./mcp-types.schema"
import { mcpSourceInputSchema, mcpSourcePatchSchema, mcpSourceSchema } from "./mcp-sources/types.schema"
import { serviceBusSettingsPatchSchema, serviceBusSettingsPublicSchema } from "./service-bus/jetstream-config.schema"
import { subagentInputSchema, subagentPatchSchema, subagentSchema } from "./subagent-types.schema"
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
  autoApplyKinds: z.array(z.enum(PACKAGE_KINDS)),
  skillAgents: z.array(z.string()),
})

function providerPreferencePatch<M extends z.ZodType>(modelOptions: M) {
  return z.object({ model: z.string(), modelOptions, planMode: z.boolean() }).partial()
}

const entityPatchShape = <P extends z.ZodType>(patch: P) => ({
  update: z.object({ id: z.string(), patch }).optional(),
  delete: z.object({ id: z.string() }).optional(),
})
const collectionPatchShape = <I extends z.ZodType, P extends z.ZodType>(input: I, patch: P) => ({
  create: input.optional(),
  ...entityPatchShape(patch),
})
const setEnabledShape = { setEnabled: z.object({ id: z.string(), enabled: z.boolean() }).optional() }

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
  subagents: z.object(collectionPatchShape(subagentInputSchema, subagentPatchSchema)).optional(),
  customMcpServers: z
    .object({
      ...collectionPatchShape(mcpServerInputSchema, mcpServerPatchSchema),
      ...setEnabledShape,
      setTestResult: z.object({ id: z.string(), result: mcpServerTestResultSchema }).optional(),
      setOAuthState: z.object({ id: z.string(), oauth: mcpOAuthStateSchema }).optional(),
    })
    .optional(),
  customBeacons: z
    .object({
      ...entityPatchShape(beaconPatchSchema),
      ...setEnabledShape,
      setScope: z.object({ id: z.string(), scope: beaconScopeSchema }).optional(),
      addTrustedScript: z.object({ id: z.string(), hash: z.string() }).optional(),
      removeTrustedScript: z.object({ id: z.string(), hash: z.string() }).optional(),
    })
    .optional(),
  customModels: z.object(collectionPatchShape(customModelInputSchema, customModelPatchSchema)).optional(),
  mcpSources: z
    .object({
      ...collectionPatchShape(mcpSourceInputSchema, mcpSourcePatchSchema),
      ...setEnabledShape,
    })
    .optional(),
  customProviders: z.object(collectionPatchShape(customProviderInputSchema, customProviderPatchSchema)).optional(),
  textSnippets: z.object(collectionPatchShape(textSnippetInputSchema, textSnippetPatchSchema)).optional(),
  claudeDriver: z.object({ lifecycle: claudeLifecycleSettingsSchema.partial().optional() }).optional(),
  globalPromptAppend: z.string().optional(),
  shareDefaultTtlHours: z.number().optional(),
  subagentRuntime: subagentRuntimeSettingsSchema.partial().optional(),
  packageUpdates: packageUpdateSettingsSchema.partial().optional(),
  plugins: pluginSettingsSchema.partial().optional(),
  remoteMcp: remoteMcpSettingsSchema.partial().optional(),
  serviceBus: serviceBusSettingsPatchSchema.optional(),
  installedPlugins: z
    .object(
      collectionPatchShape(
        z.object({ sourceDir: z.string(), id: z.string() }),
        installedPluginConfigSchema.pick({ enabled: true }).partial(),
      ),
    )
    .optional(),
})

const claudeDriverSettingsSchema = z.object({ lifecycle: claudeLifecycleSettingsSchema })

export const keybindingsSnapshotSchema = z.object({
  bindings: keybindingsBindingsSchema,
  warning: z.string().nullable(),
  filePathDisplay: z.string(),
})

export const appSettingsSnapshotSchema = z.object({
  analyticsEnabled: z.boolean(),
  browserSettingsMigrated: z.boolean(),
  theme: appThemePreferenceSchema,
  typography: typographySettingsSchema,
  chatSoundPreference: chatSoundPreferenceSchema,
  chatSoundId: chatSoundIdSchema,
  terminal: z.object({ scrollbackLines: z.number(), minColumnWidth: z.number() }),
  panes: z.object({ tabMinWidth: z.number() }),
  editor: z.object({ preset: editorPresetSchema, commandTemplate: z.string() }),
  defaultProvider: defaultProviderPreferenceSchema,
  providerDefaults: chatProviderPreferencesSchema,
  warning: z.string().nullable(),
  filePathDisplay: z.string(),
  cloudflareTunnel: cloudflareTunnelSettingsSchema,
  push: pushSettingsSchema,
  telemetry: telemetrySettingsSchema,
  auth: authSettingsSchema,
  claudeAuth: claudeAuthSettingsSchema,
  uploads: uploadSettingsSchema,
  subagents: z.array(subagentSchema),
  customMcpServers: z.array(mcpServerConfigSchema),
  customBeacons: z.array(beaconConfigSchema),
  customModels: z.array(customModelEntrySchema),
  mcpSources: z.array(mcpSourceSchema),
  customProviders: z.array(customProviderPublicSchema),
  textSnippets: z.array(textSnippetSchema),
  claudeDriver: claudeDriverSettingsSchema,
  globalPromptAppend: z.string(),
  shareDefaultTtlHours: z.number(),
  subagentRuntime: subagentRuntimeSettingsSchema,
  packageUpdates: packageUpdateSettingsSchema,
  plugins: pluginSettingsSchema,
  installedPlugins: z.array(installedPluginConfigSchema),
  remoteMcp: remoteMcpSettingsSchema,
  serviceBus: serviceBusSettingsPublicSchema,
})

assertParity<z.output<typeof claudeAuthSettingsSchema>, ClaudeAuthSettings>()
assertParity<z.output<typeof oauthTokenEntrySchema>, OAuthTokenEntry>()
assertParity<z.output<typeof keybindingsBindingsSchema>, KeybindingsSnapshot["bindings"]>()
assertParity<z.output<typeof claudeLifecycleSettingsSchema>, ClaudeLifecycleSettings>()
assertParity<z.output<typeof subagentRuntimeSettingsSchema>, SubagentRuntimeSettings>()
assertParity<z.output<typeof packageUpdateSettingsSchema>, PackageUpdateSettings>()
assertParity<z.output<typeof appSettingsPatchSchema>, AppSettingsPatch>()
assertParity<z.output<typeof claudeDriverSettingsSchema>, ClaudeDriverSettings>()
assertParity<z.output<typeof keybindingsSnapshotSchema>, KeybindingsSnapshot>()
assertParity<z.output<typeof appSettingsSnapshotSchema>, AppSettingsSnapshot>()
