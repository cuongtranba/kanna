import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills"
import { APP_VERSION } from "../../shared/branding"
import { toError } from "../../shared/errors"
import { log } from "../../shared/log"
import type { McpServerConfig } from "../../shared/mcp-types"
import { mcpServerKey } from "../genui/dataset-ports"
import { buildSourceTransport } from "../mcp-sources/mcp-source-client.adapter"
import { terminateQuietly, type SessionTerminator } from "../mcp-validator"
import type { McpSkillPort } from "./mcp-skill-port"

const CALL_TIMEOUT_MS = 20_000
const IDLE_CLOSE_MS = 60_000

interface PooledClient {
  client: Client
  skills: SkillsClient
  terminator: SessionTerminator | null
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

export function createMcpSkillClient(): McpSkillPort {
  const pool = new Map<string, Promise<PooledClient>>()

  const drop = (key: string) => {
    const entry = pool.get(key)
    pool.delete(key)
    void entry
      ?.then(async (pooled) => {
        if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
        await terminateQuietly(pooled.terminator)
        await pooled.client.close()
      })
      .catch((error: Error) => {
        log.warn("[kanna/mcp-skills] closing MCP skills client failed", { message: toError(error).message })
      })
  }

  const scheduleIdleClose = (key: string, pooled: PooledClient) => {
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    pooled.idleTimer = setTimeout(() => drop(key), IDLE_CLOSE_MS)
    pooled.idleTimer.unref?.()
  }

  const connect = async (server: McpServerConfig): Promise<PooledClient> => {
    if (server.transport === "ws") throw new Error("skills need http, sse or stdio")
    const client = new Client({ name: "kanna-skills", version: APP_VERSION })
    const transport = buildSourceTransport(server, undefined)
    try {
      await withTimeout(client.connect(transport), `connecting to ${server.name}`)
    } catch (error) {
      await client.close().catch(() => {})
      throw toError(error)
    }
    return {
      client,
      skills: new SkillsClient(client, { skipInvalid: true }),
      terminator: transport instanceof StreamableHTTPClientTransport ? transport : null,
      idleTimer: null,
    }
  }

  const withSkills = async <T>(server: McpServerConfig, run: (skills: SkillsClient) => Promise<T>): Promise<T> => {
    const key = mcpServerKey(server)
    let pending = pool.get(key)
    if (!pending) {
      pending = connect(server)
      pool.set(key, pending)
    }
    try {
      const pooled = await pending
      const result = await withTimeout(run(pooled.skills), `calling ${server.name}`)
      scheduleIdleClose(key, pooled)
      return result
    } catch (error) {
      drop(key)
      throw toError(error)
    }
  }

  return {
    discover: (server) =>
      withSkills(server, async (skills) => {
        if (!skills.supported) return { supported: false, directoryRead: false, skills: [] }
        const listing = await skills.list()
        if (listing.invalid.length > 0) {
          log.warn("[kanna/mcp-skills] server listed invalid skill entries", { server: server.name, count: listing.invalid.length })
        }
        return { supported: true, directoryRead: skills.directoryRead, skills: listing.skills, ttlMs: listing.ttlMs }
      }),
    get: (server, uri) => withSkills(server, async (skills) => (await skills.get(uri)).skill),
    read: (server, skill, ref) => withSkills(server, (skills) => skills.read(skill, ref)),
    readDirectory: (server, uri) => withSkills(server, async (skills) => (await skills.readDirectory(uri)).resources),
    close: async () => {
      for (const key of [...pool.keys()]) drop(key)
    },
  }
}
