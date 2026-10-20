import type { AppSettingsPatch, McpServerConfig } from "../shared/types"
import { ensureFreshMcpToken } from "./mcp-oauth.adapter"

export async function resolveMcpBearer<TWriteResult>(
  entry: McpServerConfig,
  appSettings: { writePatch(p: AppSettingsPatch): Promise<TWriteResult> },
): Promise<string | undefined> {
  if (entry.transport === "stdio" || entry.oauth?.status !== "authenticated") return undefined
  try {
    return await ensureFreshMcpToken(entry, {
      persist: (oauth) =>
        void appSettings.writePatch({ customMcpServers: { setOAuthState: { id: entry.id, oauth } } }),
    })
  } catch {
    return undefined
  }
}
