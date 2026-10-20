import { z } from "zod"
import { defineCommand, defineCommands, noParams, REMOTE_ALLOWED } from "./define"
import { idParams } from "./fragments"
import { appSettingsPatchSchema, claudeAuthSettingsSchema, keybindingsBindingsSchema } from "../app-settings-types.schema"
import { llmProviderKindSchema } from "../core-types.schema"
import { cloudflareTunnelSettingsSchema } from "../settings/settings.schema"
import { subagentInputSchema, subagentPatchSchema } from "../subagent-types.schema"

const llmProviderParams = z.object({
  provider: llmProviderKindSchema,
  apiKey: z.string(),
  model: z.string(),
  baseUrl: z.string(),
})

export const settingsCommands = defineCommands(
  defineCommand("settings.readKeybindings", {
    params: noParams,
    summary: "Read the keybindings snapshot.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeKeybindings", {
    params: z.object({ bindings: keybindingsBindingsSchema }),
    summary: "Replace the keybindings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.readAppSettings", {
    params: noParams,
    summary: "Read the application settings snapshot.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeAppSettings", {
    params: z.object({ analyticsEnabled: z.boolean() }),
    summary: "Enable or disable analytics.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeAppSettingsPatch", {
    params: z.object({ patch: appSettingsPatchSchema.describe("A partial settings object, for example {\"remoteMcp\":{\"enabled\":false}}") }),
    summary: "Apply a partial update to the application settings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.testMcpServer", {
    params: idParams,
    summary: "Probe a configured custom MCP server and record the result.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.startMcpOAuth", {
    params: idParams,
    summary: "Begin the OAuth flow for a custom MCP server and return the authorization URL.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.completeMcpOAuth", {
    params: z.object({ id: z.string(), callbackUrl: z.string() }),
    summary: "Finish a custom MCP server OAuth flow from the pasted callback URL.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.readLlmProvider", {
    params: noParams,
    summary: "Read the LLM provider used for title and commit-message generation.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.listOpenRouterModels", {
    params: noParams,
    summary: "List the models available from OpenRouter.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.getChangelog", {
    params: noParams,
    summary: "Read the Kanna changelog.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.writeLlmProvider", {
    params: llmProviderParams,
    summary: "Save the LLM provider configuration.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("settings.validateLlmProvider", {
    params: llmProviderParams,
    summary: "Validate an LLM provider configuration with a test call.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("appSettings.setCloudflareTunnel", {
    params: z.object({ patch: cloudflareTunnelSettingsSchema.partial() }),
    summary: "Update the Cloudflare tunnel settings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("appSettings.setClaudeAuth", {
    params: z.object({ patch: claudeAuthSettingsSchema.partial() }),
    summary: "Update the Claude authentication settings.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("appSettings.testOAuthToken", {
    params: z.object({ token: z.string(), baseUrl: z.string().optional() }),
    summary: "Test a Claude OAuth token against the API.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagent.create", {
    params: z.object({ input: subagentInputSchema }),
    summary: "Create a subagent definition.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagent.update", {
    params: z.object({ id: z.string(), patch: subagentPatchSchema }),
    summary: "Update a subagent definition.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("subagent.delete", {
    params: idParams,
    summary: "Delete a subagent definition.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
)
