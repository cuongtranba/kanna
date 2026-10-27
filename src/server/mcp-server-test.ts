import type { AppSettingsPatch, McpServerConfig, McpServerTestResult } from "../shared/types"
import { resolveMcpBearer } from "./mcp-bearer"
import { validateMcpServer } from "./mcp-validator"

export async function testMcpServer<TWriteResult>(
  entry: McpServerConfig,
  appSettings: { writePatch(p: AppSettingsPatch): Promise<TWriteResult> },
): Promise<McpServerTestResult> {
  const record = (result: McpServerTestResult) =>
    appSettings.writePatch({ customMcpServers: { setTestResult: { id: entry.id, result } } })
  await record({ status: "pending", startedAt: new Date().toISOString() })
  const bearer = await resolveMcpBearer(entry, appSettings)
  const result = await validateMcpServer(entry, bearer ? { bearer } : {})
  await record(result)
  return result
}
