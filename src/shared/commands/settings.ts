import { z } from "zod"
import { defineCommand, defineCommands, noParams, REMOTE_ALLOWED } from "./define"
import { idParams } from "./fragments"
import {
  appSettingsPatchSchema,
  appSettingsSnapshotSchema,
  claudeAuthSettingsSchema,
  keybindingsBindingsSchema,
  keybindingsSnapshotSchema,
} from "../app-settings-types.schema"
import { llmProviderKindSchema } from "../core-types.schema"
import { mcpOAuthCompleteResultSchema, mcpOAuthStartResultSchema, mcpServerTestCommandResultSchema } from "../mcp-types.schema"
import { openRouterModelSchema } from "../provider-model-types.schema"
import { cloudflareTunnelSettingsSchema } from "../settings/settings.schema"
import {
  subagentCommandResultSchema,
  subagentDeleteResultSchema,
  subagentInputSchema,
  subagentPatchSchema,
} from "../subagent-types.schema"
import {
  githubReleaseSchema,
  llmProviderSnapshotSchema,
  llmProviderValidationResultSchema,
  oauthTokenTestResultSchema,
} from "../types.schema"

const llmProviderParams = z.object({
  provider: llmProviderKindSchema,
  apiKey: z.string(),
  model: z.string(),
  baseUrl: z.string(),
})

export const settingsCommands = defineCommands(
  defineCommand("settings.readKeybindings", {
    params: noParams,
    result: keybindingsSnapshotSchema,
    summary: "Read the keybindings snapshot.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeKeybindings", {
    params: z.object({ bindings: keybindingsBindingsSchema }),
    result: keybindingsSnapshotSchema,
    summary: "Replace the keybindings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.readAppSettings", {
    params: noParams,
    result: appSettingsSnapshotSchema,
    summary: "Read the application settings snapshot.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeAppSettings", {
    params: z.object({ analyticsEnabled: z.boolean() }),
    result: appSettingsSnapshotSchema,
    summary: "Enable or disable analytics.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeAppSettingsPatch", {
    params: z.object({ patch: appSettingsPatchSchema.describe("A partial settings object, for example {\"remoteMcp\":{\"enabled\":false}}") }),
    result: appSettingsSnapshotSchema,
    summary: "Apply a partial update to the application settings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.testMcpServer", {
    params: idParams,
    result: mcpServerTestCommandResultSchema,
    summary: "Probe a configured custom MCP server and record the result.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.startMcpOAuth", {
    params: idParams,
    result: mcpOAuthStartResultSchema,
    summary: "Begin the OAuth flow for a custom MCP server and return the authorization URL.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.completeMcpOAuth", {
    params: z.object({ id: z.string(), callbackUrl: z.string() }),
    result: mcpOAuthCompleteResultSchema,
    summary: "Finish a custom MCP server OAuth flow from the pasted callback URL.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.readLlmProvider", {
    params: noParams,
    result: llmProviderSnapshotSchema,
    summary: "Read the LLM provider used for title and commit-message generation.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.listOpenRouterModels", {
    params: noParams,
    result: z.array(openRouterModelSchema),
    summary: "List the models available from OpenRouter.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.getChangelog", {
    params: noParams,
    result: z.array(githubReleaseSchema),
    summary: "Read the Kanna changelog.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeLlmProvider", {
    params: llmProviderParams,
    result: llmProviderSnapshotSchema,
    summary: "Save the LLM provider configuration.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.validateLlmProvider", {
    params: llmProviderParams,
    result: llmProviderValidationResultSchema,
    summary: "Validate an LLM provider configuration with a test call.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("appSettings.setCloudflareTunnel", {
    params: z.object({ patch: cloudflareTunnelSettingsSchema.partial() }),
    result: appSettingsSnapshotSchema,
    summary: "Update the Cloudflare tunnel settings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("appSettings.setClaudeAuth", {
    params: z.object({ patch: claudeAuthSettingsSchema.partial() }),
    result: appSettingsSnapshotSchema,
    summary: "Update the Claude authentication settings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("appSettings.testOAuthToken", {
    params: z.object({ token: z.string(), baseUrl: z.string().optional() }),
    result: oauthTokenTestResultSchema,
    summary: "Test a Claude OAuth token against the API.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagent.create", {
    params: z.object({ input: subagentInputSchema }),
    result: subagentCommandResultSchema,
    summary: "Create a subagent definition.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagent.update", {
    params: z.object({ id: z.string(), patch: subagentPatchSchema }),
    result: subagentCommandResultSchema,
    summary: "Update a subagent definition.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagent.delete", {
    params: idParams,
    result: subagentDeleteResultSchema,
    summary: "Delete a subagent definition.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
)
