import type { AppSettingsSnapshot } from "../shared/types"

export interface AgentAppSettingsView {
  claudeDriver: AppSettingsSnapshot["claudeDriver"]
  globalPromptAppend: AppSettingsSnapshot["globalPromptAppend"]
  customMcpServers: AppSettingsSnapshot["customMcpServers"]
  customModels: AppSettingsSnapshot["customModels"]
  customProviders: AppSettingsSnapshot["customProviders"]
  providerDefaults: AppSettingsSnapshot["providerDefaults"]
  subagentRuntime: AppSettingsSnapshot["subagentRuntime"]
}

export function buildAgentAppSettingsView(snapshot: AppSettingsSnapshot): AgentAppSettingsView {
  return {
    claudeDriver: snapshot.claudeDriver,
    globalPromptAppend: snapshot.globalPromptAppend,
    customMcpServers: snapshot.customMcpServers,
    customModels: snapshot.customModels,
    customProviders: snapshot.customProviders,
    providerDefaults: snapshot.providerDefaults,
    subagentRuntime: snapshot.subagentRuntime,
  }
}
