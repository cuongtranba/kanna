import type { AppSettingsPatch, AppSettingsSnapshot } from "../../shared/types"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"
import { resolveChatCwd, type ChatCwdStore } from "../claude-session-config"
import { resolveMcpTestBearer } from "../ws-router-settings"
import { datasetFileReader } from "./dataset-file.adapter"
import { GenUIDatasetService } from "./dataset-service"
import { createMcpDataClient } from "./mcp-data-client.adapter"

export function createGenUIDatasetService<TWriteResult>(
  store: ChatCwdStore,
  appSettings: { getSnapshot(): AppSettingsSnapshot; writePatch(patch: AppSettingsPatch): Promise<TWriteResult> },
  resolveChatPolicy: (chatId: string) => ChatPermissionPolicy,
): GenUIDatasetService {
  return new GenUIDatasetService({
    files: datasetFileReader,
    mcp: createMcpDataClient((server) => resolveMcpTestBearer(server, appSettings)),
    scopeOf: (chatId) => {
      const cwd = resolveChatCwd(store, chatId)
      return cwd ? { cwd, policy: resolveChatPolicy(chatId) } : null
    },
    mcpServers: () => appSettings.getSnapshot().customMcpServers,
  })
}
