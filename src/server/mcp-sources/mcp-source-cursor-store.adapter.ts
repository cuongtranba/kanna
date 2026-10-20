import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"
import type { McpSourceCursorStorePort, McpSourceCursors } from "./mcp-source-runner"

const FILE_NAME = "mcp-source-cursors.json"

export function parseMcpSourceCursors(text: string): McpSourceCursors {
  const parsed = safeJsonParse(text)
  if (parsed === null || !isJsonObject(parsed)) return {}
  const out: McpSourceCursors = {}
  for (const [id, state] of Object.entries(parsed)) {
    if (!isJsonObject(state)) continue
    const cursor: JsonValue = state.cursor ?? null
    const keys = state.recentKeys
    out[id] = {
      cursor,
      recentKeys: keys !== undefined && isJsonArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [],
    }
  }
  return out
}

export function createFileMcpSourceCursorStore(dataDir: string): McpSourceCursorStorePort {
  const path = join(dataDir, FILE_NAME)
  const tempPath = `${path}.tmp`
  return {
    async load() {
      try {
        return parseMcpSourceCursors(await readFile(path, "utf8"))
      } catch {
        return {}
      }
    },
    async save(all) {
      await mkdir(dataDir, { recursive: true })
      await writeFile(tempPath, JSON.stringify(all, null, 2))
      await rename(tempPath, path)
    },
  }
}
