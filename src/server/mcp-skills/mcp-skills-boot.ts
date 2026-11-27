import type { McpServerConfig } from "../../shared/mcp-types"
import type { AppSettingsSnapshot } from "../../shared/app-settings-types"
import { localCommandsForCwd, type SlashCommandsDeps } from "../claude-slash-commands"
import { resolveChatCwd, type ChatCwdStore } from "../claude-session-config"
import type { ResolveCustomMcpServers } from "../claude-session-config-helpers"
import { mcpServerKey } from "../genui/dataset-ports"
import type { Lifetime } from "../lifetime"
import { createMcpSkillAccess, type McpSkillAccess } from "./mcp-skill-access"
import { createMcpSkillClient } from "./mcp-skill-client.adapter"
import { McpSkillHost, type McpSkillClock } from "./mcp-skill-host"
import type { McpSkillPort } from "./mcp-skill-port"

const realClock: McpSkillClock = {
  now: () => Date.now(),
  after: (delayMs, run) => {
    const timer = setTimeout(run, delayMs)
    return () => clearTimeout(timer)
  },
}

export interface McpSkillsBootArgs {
  appSettings: {
    getSnapshot(): Pick<AppSettingsSnapshot, "customMcpServers">
    onChange(listener: () => void): () => void
  }
  resolveServers: ResolveCustomMcpServers
  store: ChatCwdStore
  slashSources: Pick<SlashCommandsDeps, "localCatalog" | "cliCommands">
  onChange: () => void
  lifetime: Pick<Lifetime, "defer">
  port?: McpSkillPort
}

function serversSignature(servers: readonly McpServerConfig[]): string {
  return servers.map((server) => `${mcpServerKey(server)}\u0001${String(server.enabled)}\u0001${String(server.skills)}`).join("\u0002")
}

export function startMcpSkills(args: McpSkillsBootArgs): McpSkillAccess {
  const port = args.port ?? createMcpSkillClient()
  const host = new McpSkillHost({
    port,
    servers: async () => (await args.resolveServers()).servers,
    clock: realClock,
  })
  const reservedNames = (chatId: string) => {
    const cwd = resolveChatCwd(args.store, chatId)
    const sources = cwd === undefined ? { ...args.slashSources, localCatalog: null } : args.slashSources
    return new Set(localCommandsForCwd(sources, cwd ?? "").map((command) => command.name.toLowerCase()))
  }
  let lastSignature = serversSignature(args.appSettings.getSnapshot().customMcpServers)
  void host.refresh()
  const stopSettings = args.appSettings.onChange(() => {
    const next = serversSignature(args.appSettings.getSnapshot().customMcpServers)
    if (next === lastSignature) return
    lastSignature = next
    void host.refresh()
  })
  const stopChange = host.onChange(args.onChange)
  args.lifetime.defer("teardown", async () => {
    stopSettings()
    stopChange()
    await port.close()
  })
  return createMcpSkillAccess(host, reservedNames)
}
