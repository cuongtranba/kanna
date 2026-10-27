import type { AppSettingsSnapshot } from "../../shared/app-settings-types"
import { appSettingsSnapshotSchema } from "../../shared/app-settings-types.schema"
import { commandsReturning } from "../../shared/commands"
import type { McpOAuthState, McpServerConfig } from "../../shared/mcp-types"
import type { ClientCommand, CommandResult, ServerEnvelope, ServerSnapshot, SubscriptionTopic } from "../../shared/protocol"
import type { LlmProviderSnapshot } from "../../shared/types"
import { llmProviderSnapshotSchema } from "../../shared/types.schema"
import { REDACTED } from "./redact-secrets"

export interface EgressHost {
  dispatchCommand: (command: ClientCommand) => Promise<ServerEnvelope>
  readSnapshot: (topic: SubscriptionTopic) => ServerEnvelope
}

const APP_SETTINGS_ACK_COMMANDS = commandsReturning(appSettingsSnapshotSchema)
const LLM_PROVIDER_ACK_COMMANDS = commandsReturning(llmProviderSnapshotSchema)

export function redactedAckCommandTypes(): ReadonlySet<ClientCommand["type"]> {
  return new Set([...APP_SETTINGS_ACK_COMMANDS, ...LLM_PROVIDER_ACK_COMMANDS])
}

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

const WITHHELD_MESSAGE = "The result was withheld because it did not have the expected shape for a command that carries secrets."

type RedactedAck = { readonly withheld: false; readonly result: CommandResult<ClientCommand> } | { readonly withheld: true }

const WITHHELD: RedactedAck = { withheld: true }

function redactAckResult(command: ClientCommand, result: CommandResult<ClientCommand>): RedactedAck {
  if (APP_SETTINGS_ACK_COMMANDS.has(command.type)) {
    return isAppSettingsSnapshot(result) ? { withheld: false, result: redactAppSettingsSnapshot(result) } : WITHHELD
  }
  if (LLM_PROVIDER_ACK_COMMANDS.has(command.type)) {
    return isLlmProviderSnapshot(result) ? { withheld: false, result: redactLlmProviderSnapshot(result) } : WITHHELD
  }
  return { withheld: false, result }
}

export function redactCommandEnvelope(command: ClientCommand, envelope: ServerEnvelope): ServerEnvelope {
  if (envelope.type === "snapshot") return { ...envelope, snapshot: redactSnapshot(envelope.snapshot) }
  if (envelope.type !== "ack" || envelope.result === undefined) return envelope
  const redacted = redactAckResult(command, envelope.result)
  if (redacted.withheld) return { v: envelope.v, type: "error", id: envelope.id, message: WITHHELD_MESSAGE }
  return { ...envelope, result: redacted.result }
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
