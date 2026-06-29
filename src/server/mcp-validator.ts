import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import type { McpServerConfig, McpServerTestResult } from "../shared/types"

const DEFAULT_TIMEOUT_MS = 10_000

export interface ValidateMcpOptions {
  timeoutMs?: number
  /** Optional pre-resolved bearer token to inject for oauth servers. */
  bearer?: string
}

export function networkHeaders(
  config: Pick<Extract<McpServerConfig, { transport: "http" | "sse" | "ws" }>, "headers">,
  bearer: string | undefined,
): Record<string, string> {
  if (!bearer) return config.headers
  return { ...config.headers, Authorization: `Bearer ${bearer}` }
}

export async function validateMcpServer(
  config: McpServerConfig,
  opts: ValidateMcpOptions = {},
): Promise<McpServerTestResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let client: Client | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  try {
    client = new Client({ name: "kanna-validator", version: "0.0.0" }, { capabilities: {} })
    const transport = buildTransport(config, opts.bearer)

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        reject(new Error(`connection timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    await Promise.race([client.connect(transport), timeoutPromise])
    const tools = await Promise.race([client.listTools(), timeoutPromise])
    return {
      status: "ok",
      testedAt: new Date().toISOString(),
      toolCount: Array.isArray(tools.tools) ? tools.tools.length : 0,
    }
  } catch (err) {
    return {
      status: "error",
      testedAt: new Date().toISOString(),
      message: formatError(err, timeoutMs, config, timedOut),
    }
  } finally {
    if (timer) clearTimeout(timer)
    if (client) {
      try {
        await client.close()
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function buildTransport(config: McpServerConfig, bearer?: string) {
  switch (config.transport) {
    case "stdio":
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...(process.env as Record<string, string>), ...config.env },
        cwd: config.cwd,
      })
    case "http":
      return new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: networkHeaders(config, bearer) },
      })
    case "sse":
      return new SSEClientTransport(new URL(config.url), {
        requestInit: { headers: networkHeaders(config, bearer) },
      })
    case "ws":
      return new WebSocketClientTransport(new URL(config.url))
  }
}

function formatError(
  err: unknown,
  timeoutMs: number,
  config: McpServerConfig,
  timedOut: boolean,
): string {
  if (timedOut) return `connection timed out after ${Math.round(timeoutMs / 1000)}s`

  const raw = err instanceof Error ? err.message : String(err)

  if (raw.toLowerCase().includes("timed out")) {
    return `connection timed out after ${Math.round(timeoutMs / 1000)}s`
  }

  if (config.transport === "stdio") {
    if (raw.includes("ENOENT") || raw.includes("ENOTDIR") || raw.toLowerCase().includes("not found")) {
      return `command not found: ${config.command}`
    }
  } else {
    // Check for SDK-typed HTTP error (StreamableHTTPError carries numeric code)
    if (err instanceof StreamableHTTPError) {
      const code = err.code
      if (code === 401 || code === 403) return "unauthorized (check headers/env)"
      let host = "host"
      try {
        host = new URL(config.url).host
      } catch {
        // ignore URL parse error
      }
      return `HTTP ${code} from ${host}`
    }

    // Fallback: scan for a 3-digit HTTP status code in the error message
    const m = raw.match(/\b(\d{3})\b/)
    if (m) {
      const status = Number(m[1])
      if (status === 401 || status === 403) return "unauthorized (check headers/env)"
      let host = "host"
      try {
        host = new URL(config.url).host
      } catch {
        // ignore URL parse error
      }
      return `HTTP ${status} from ${host}`
    }
  }

  return raw
}
