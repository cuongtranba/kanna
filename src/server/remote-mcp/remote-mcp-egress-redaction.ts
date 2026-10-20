import type { AppSettingsSnapshot } from "../../shared/app-settings-types"
import type { McpOAuthState, McpServerConfig } from "../../shared/mcp-types"
import type { ClientCommand, CommandResult, ServerEnvelope, ServerSnapshot, SubscriptionTopic } from "../../shared/protocol"
import type { LlmProviderSnapshot } from "../../shared/types"
import { REDACTED } from "./redact-secrets"

export interface EgressHost {
  dispatchCommand: (command: ClientCommand) => Promise<ServerEnvelope>
  readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
}

const APP_SETTINGS_ACK_COMMANDS: ReadonlySet<ClientCommand["type"]> = new Set<ClientCommand["type"]>([
  "settings.readAppSettings",
  "settings.writeAppSettings",
  "settings.writeAppSettingsPatch",
  "appSettings.setCloudflareTunnel",
  "appSettings.setClaudeAuth",
])

const LLM_PROVIDER_ACK_COMMANDS: ReadonlySet<ClientCommand["type"]> = new Set<ClientCommand["type"]>([
  "settings.readLlmProvider",
  "settings.writeLlmProvider",
])

function maskSecret(value: string): string {
  return value === "" ? value : REDACTED
}

function maskValues(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, maskSecret(value)]))
}

function publicOAuthState({ enabled, status, errorMessage, issuer, obtainedAt }: McpOAuthState): McpOAuthState {
  return {
    enabled,
    status,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(issuer !== undefined ? { issuer } : {}),
    ...(obtainedAt !== undefined ? { obtainedAt } : {}),
  }
}

function publicMcpServer(server: McpServerConfig): McpServerConfig {
  if (server.transport === "stdio") return { ...server, env: maskValues(server.env) }
  return {
    ...server,
    headers: maskValues(server.headers),
    ...(server.oauth ? { oauth: publicOAuthState(server.oauth) } : {}),
  }
}

export function redactAppSettingsSnapshot(settings: AppSettingsSnapshot): AppSettingsSnapshot {
  return {
    ...settings,
    claudeAuth: {
      ...settings.claudeAuth,
      tokens: settings.claudeAuth.tokens.map((entry) => ({ ...entry, token: maskSecret(entry.token) })),
    },
    customMcpServers: settings.customMcpServers.map(publicMcpServer),
  }
}

export function redactLlmProviderSnapshot(provider: LlmProviderSnapshot): LlmProviderSnapshot {
  return { ...provider, apiKey: maskSecret(provider.apiKey) }
}

export function redactSnapshot(snapshot: ServerSnapshot): ServerSnapshot {
  if (snapshot.type === "app-settings") return { type: snapshot.type, data: redactAppSettingsSnapshot(snapshot.data) }
  if (snapshot.type === "llm-provider") return { type: snapshot.type, data: redactLlmProviderSnapshot(snapshot.data) }
  return snapshot
}

function isAppSettingsSnapshot(result: CommandResult<ClientCommand>): result is AppSettingsSnapshot {
  return typeof result === "object" && result !== null && "claudeAuth" in result && "customMcpServers" in result
}

function isLlmProviderSnapshot(result: CommandResult<ClientCommand>): result is LlmProviderSnapshot {
  return typeof result === "object" && result !== null && "apiKey" in result && typeof result.apiKey === "string"
}

function redactAckResult(command: ClientCommand, result: CommandResult<ClientCommand>): CommandResult<ClientCommand> | undefined {
  if (APP_SETTINGS_ACK_COMMANDS.has(command.type)) {
    return isAppSettingsSnapshot(result) ? redactAppSettingsSnapshot(result) : undefined
  }
  if (LLM_PROVIDER_ACK_COMMANDS.has(command.type)) {
    return isLlmProviderSnapshot(result) ? redactLlmProviderSnapshot(result) : undefined
  }
  return result
}

export function redactCommandEnvelope(command: ClientCommand, envelope: ServerEnvelope): ServerEnvelope {
  if (envelope.type === "snapshot") return { ...envelope, snapshot: redactSnapshot(envelope.snapshot) }
  if (envelope.type !== "ack" || envelope.result === undefined) return envelope
  return { ...envelope, result: redactAckResult(command, envelope.result) }
}

export function redactReadEnvelope(envelope: ServerEnvelope): ServerEnvelope {
  return envelope.type === "snapshot" ? { ...envelope, snapshot: redactSnapshot(envelope.snapshot) } : envelope
}

export function withEgressRedaction<Host extends EgressHost>(host: Host): Host {
  return {
    ...host,
    dispatchCommand: async (command: ClientCommand) => redactCommandEnvelope(command, await host.dispatchCommand(command)),
    readSnapshot: (topic: SubscriptionTopic) => redactReadEnvelope(host.readSnapshot(topic)),
  }
}
