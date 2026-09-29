import type { JsonObject, JsonValue } from "../../shared/json"
import type { McpServerConfig } from "../../shared/mcp-types"
import type { ChatPermissionPolicy } from "../../shared/permission-policy"

export type ResolvedDatasetFile =
  | { ok: true; absolutePath: string; revision: string; size: number }
  | { ok: false; reason: "not_found" | "outside_root" | "not_a_file" }

export interface DatasetFileReader {
  resolve(root: string, relativePath: string): Promise<ResolvedDatasetFile>
  readText(absolutePath: string): Promise<string>
}

export interface McpToolDescriptor {
  name: string
  readOnly: boolean
}

export type McpToolResult = { ok: true; value: JsonValue } | { ok: false; message: string }

export interface McpDataClient {
  listTools(server: McpServerConfig): Promise<McpToolDescriptor[]>
  callTool(server: McpServerConfig, tool: string, args: JsonObject): Promise<McpToolResult>
}

export interface GenUIDataScope {
  cwd: string
  policy: ChatPermissionPolicy
}
