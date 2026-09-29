import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { toError } from "../../shared/errors"
import { jsonValueSchema } from "../../shared/genui/json-schema"
import type { JsonObject } from "../../shared/json"
import { log } from "../../shared/log"
import type { McpServerConfig } from "../../shared/mcp-types"
import { buildTransport } from "../mcp-validator"
import type { McpDataClient, McpToolDescriptor, McpToolResult } from "./dataset-ports"

const CALL_TIMEOUT_MS = 20_000
const IDLE_CLOSE_MS = 60_000

interface PooledClient {
  client: Client
  idleTimer: ReturnType<typeof setTimeout> | null
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${CALL_TIMEOUT_MS / 1000}s`)), CALL_TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export function createMcpDataClient(bearerFor: (server: McpServerConfig) => Promise<string | undefined>): McpDataClient {
  const pool = new Map<string, Promise<PooledClient>>()

  const keyOf = (server: McpServerConfig) => `${server.id}\u0001${server.updatedAt}`

  const drop = (key: string) => {
    const entry = pool.get(key)
    pool.delete(key)
    void entry?.then((pooled) => pooled.client.close()).catch((error: Error) => {
      log.warn("[kanna/genui] closing MCP data client failed", { message: toError(error).message })
    })
  }

  const scheduleIdleClose = (key: string, pooled: PooledClient) => {
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    pooled.idleTimer = setTimeout(() => drop(key), IDLE_CLOSE_MS)
    pooled.idleTimer.unref?.()
  }

  const connect = async (server: McpServerConfig): Promise<PooledClient> => {
    const client = new Client({ name: "kanna-genui", version: "1.0.0" }, { capabilities: {} })
    await withTimeout(client.connect(buildTransport(server, await bearerFor(server))), `connecting to ${server.name}`)
    return { client, idleTimer: null }
  }

  const withClient = async <T>(server: McpServerConfig, run: (client: Client) => Promise<T>): Promise<T> => {
    const key = keyOf(server)
    let pending = pool.get(key)
    if (!pending) {
      pending = connect(server)
      pool.set(key, pending)
    }
    try {
      const pooled = await pending
      const result = await withTimeout(run(pooled.client), `calling ${server.name}`)
      scheduleIdleClose(key, pooled)
      return result
    } catch (error) {
      drop(key)
      throw error
    }
  }

  return {
    listTools: async (server): Promise<McpToolDescriptor[]> =>
      await withClient(server, async (client) => {
        const listed = await client.listTools()
        return listed.tools.map((tool) => ({ name: tool.name, readOnly: tool.annotations?.readOnlyHint === true }))
      }),

    callTool: async (server, tool, args: JsonObject): Promise<McpToolResult> => {
      try {
        return await withClient(server, async (client) => {
          const raw = await client.callTool({ name: tool, arguments: args })
          const result = CallToolResultSchema.safeParse(raw)
          if (!result.success) return { ok: false, message: `${tool} returned an unrecognised result` }
          const text = result.data.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join("\n")
          if (result.data.isError) return { ok: false, message: text || `${tool} reported an error` }
          const structured = jsonValueSchema.safeParse(result.data.structuredContent)
          if (result.data.structuredContent !== undefined && structured.success) return { ok: true, value: structured.data }
          return { ok: true, value: text }
        })
      } catch (error) {
        return { ok: false, message: toError(error).message }
      }
    },
  }
}
