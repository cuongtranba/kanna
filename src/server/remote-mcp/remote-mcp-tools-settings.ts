import type { ToolRegistrar } from "./remote-mcp-tool-registrar"
import { z } from "zod"
import { jsonObjectSchema } from "../../shared/genui/json-schema"
import { isJsonObject, type JsonValue } from "../../shared/json"
import type { AppSettingsPatch } from "../../shared/app-settings-types"
import { fail } from "../kanna-mcp-tool"
import { redactSecrets } from "./redact-secrets"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { commandResult, jsonResult, runCommand } from "./remote-mcp-views"

function isSettingsPatchShape(value: JsonValue): value is JsonValue & AppSettingsPatch {
  return isJsonObject(value)
}

export function registerSettingsTools(tools: ToolRegistrar, host: RemoteMcpHost): void {
  tools.registerTool(
    "read_app_settings",
    {
      title: "Read app settings",
      inputSchema: z.object({}),
      description: "Read Kanna's application settings. Values that look like secrets (API keys, tokens, passwords, env and headers) are redacted.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const outcome = await runCommand(host, { type: "settings.readAppSettings" })
      return outcome.ok ? jsonResult(redactSecrets(outcome.result)) : fail(outcome.message)
    },
  )

  tools.registerTool(
    "patch_app_settings",
    {
      title: "Patch app settings",
      description: "Apply a partial update to Kanna's application settings, for example {\"remoteMcp\":{\"enabled\":false}}. The server validates the patch; the updated settings are returned with secrets redacted.",
      inputSchema: z.object({ patch: jsonObjectSchema.describe("A partial AppSettingsPatch object") }),
    },
    async ({ patch }) => {
      if (!isSettingsPatchShape(patch)) return fail("The patch must be an object.")
      const outcome = await runCommand(host, { type: "settings.writeAppSettingsPatch", patch })
      return outcome.ok ? jsonResult(redactSecrets(outcome.result)) : fail(outcome.message)
    },
  )

  tools.registerTool(
    "list_subagents",
    {
      title: "List subagents",
      inputSchema: z.object({}),
      description: "List the configured subagents with their id, name, description, provider and model.",
      annotations: { readOnlyHint: true },
    },
    () => {
      const envelope = host.readSnapshot({ type: "app-settings" })
      if (envelope.type !== "snapshot" || envelope.snapshot.type !== "app-settings") return fail("The settings snapshot is unavailable.")
      return jsonResult({
        subagents: envelope.snapshot.data.subagents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          provider: agent.provider,
          model: agent.model,
        })),
      })
    },
  )

  tools.registerTool(
    "list_installed_packages",
    {
      title: "List installed packages",
      inputSchema: z.object({}),
      description: "List installed skills and plugins with their update availability.",
      annotations: { readOnlyHint: true },
    },
    () => commandResult(host, { type: "packages.listInstalled" }),
  )

  tools.registerTool(
    "check_package_updates",
    {
      title: "Check package updates",
      inputSchema: z.object({}),
      description: "Check installed skills and plugins for available updates.",
      annotations: { readOnlyHint: true },
    },
    () => commandResult(host, { type: "packages.checkUpdates" }),
  )
}
