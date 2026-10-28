import { z } from "zod"
import { fail } from "../kanna-mcp-tool"
import { commandTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"
import { jsonResult, readTopic } from "./remote-mcp-views"

export const settingsTools: readonly RemoteTool[] = [
  commandTool({
    name: "read_app_settings",
    title: "Read app settings",
    description: "Read Kanna's application settings. Values that look like secrets (API keys, tokens, passwords, env and headers) are redacted.",
    annotations: { readOnlyHint: true },
    command: "settings.readAppSettings",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "settings.readAppSettings", ...args }),
  }),
  commandTool({
    name: "patch_app_settings",
    title: "Patch app settings",
    description: "Apply a partial update to Kanna's application settings, for example {\"remoteMcp\":{\"enabled\":false}}. The server validates the patch; the updated settings are returned with secrets redacted.",
    command: "settings.writeAppSettingsPatch",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "settings.writeAppSettingsPatch", ...args }),
  }),
  topicTool({
    name: "list_subagents",
    title: "List subagents",
    description: "List the configured subagents with their id, name, description, provider and model.",
    annotations: { readOnlyHint: true },
    topic: "app-settings",
    input: z.object({}),
    handle: (_args, { host }) => {
      const settings = readTopic(host, { type: "app-settings" })
      if (!settings) return fail("The settings snapshot is unavailable.")
      return jsonResult({
        subagents: settings.subagents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          provider: agent.provider,
          model: agent.model,
        })),
      })
    },
  }),
  commandTool({
    name: "list_installed_packages",
    title: "List installed packages",
    description: "List installed skills and plugins with their update availability.",
    annotations: { readOnlyHint: true },
    command: "packages.listInstalled",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "packages.listInstalled", ...args }),
  }),
  commandTool({
    name: "check_package_updates",
    title: "Check package updates",
    description: "Check installed skills and plugins for available updates.",
    annotations: { readOnlyHint: true },
    command: "packages.checkUpdates",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "packages.checkUpdates", ...args }),
  }),
]
