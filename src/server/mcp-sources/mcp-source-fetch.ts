import { createHash } from "node:crypto"
import { isJsonArray, jsonText, resolveJsonPath, type JsonValue } from "../../shared/json"
import type { McpPollSource, McpSource, McpSubscribeSource } from "../../shared/mcp-sources/types"
import type { McpSourceConnection } from "./mcp-source-runner"

export interface FetchedItem {
  body: JsonValue
  key: string
  threadKey: string
}

export interface McpSourceFetchResult {
  items: FetchedItem[]
  cursor?: JsonValue
}

export interface McpSourceFetcher {
  fetch(connection: McpSourceConnection, cursor: JsonValue | null, uris: readonly string[]): Promise<McpSourceFetchResult>
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export function textAt(item: JsonValue, path: string): string {
  return path.length > 0 ? jsonText(resolveJsonPath(item, path)).trim() : ""
}

function itemsAt(payload: JsonValue, path: string, origin: string): readonly JsonValue[] {
  const found = resolveJsonPath(payload, path)
  if (found === undefined || !isJsonArray(found)) {
    throw new Error(`"${path}" did not resolve to an array in the ${origin} result`)
  }
  return found
}

function keyedItem(item: JsonValue, itemKeyPath: string | null): FetchedItem {
  const key = (itemKeyPath ? textAt(item, itemKeyPath) : "") || sha256(JSON.stringify(item))
  return { body: item, key, threadKey: key }
}

function resourceFetcher(source: McpSubscribeSource): McpSourceFetcher {
  return {
    async fetch(connection, _cursor, uris) {
      const items: FetchedItem[] = []
      for (const uri of uris) {
        const contents = await connection.readResource(uri)
        if (source.itemsPath.length === 0) {
          items.push({ body: { uri, contents }, key: sha256(uri + JSON.stringify(contents)), threadKey: uri })
          continue
        }
        for (const item of itemsAt(contents, source.itemsPath, uri)) items.push(keyedItem(item, source.itemKeyPath))
      }
      return { items }
    },
  }
}

function toolFetcher(source: McpPollSource): McpSourceFetcher {
  return {
    async fetch(connection, cursor) {
      const args = cursor === null ? source.args : { ...source.args, [source.cursorArg]: cursor }
      const result = await connection.callTool(source.tool, args)
      const items = itemsAt(result, source.itemsPath, source.tool).map((item) => keyedItem(item, source.itemKeyPath))
      const next = resolveJsonPath(result, source.cursorPath)
      return next === undefined ? { items } : { items, cursor: next }
    },
  }
}

export function fetcherFor(source: McpSource): McpSourceFetcher {
  switch (source.mode) {
    case "subscribe":
      return resourceFetcher(source)
    case "poll":
      return toolFetcher(source)
  }
}
