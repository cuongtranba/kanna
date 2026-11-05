import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type EmptyResult,
  type McpSubscription,
  type SubscriptionFilter,
  type Transport,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { APP_VERSION } from "../../shared/branding"
import { toError } from "../../shared/errors"
import { safeJsonParse, type JsonValue } from "../../shared/json"
import type { McpServerConfig } from "../../shared/mcp-types"
import { toJsonValue } from "../json-boundary"
import { networkHeaders, stdioEnv, terminateQuietly, type SessionTerminator } from "../mcp-validator"
import {
  McpToolRejectedError,
  type McpSourceCloseReason,
  type McpSourceConnection,
  type McpSourceConnector,
  type McpSourceListening,
} from "./mcp-source-runner"

const CONNECT_TIMEOUT_MS = 20_000
const JSON_LOOKING = /^\s*[{[]/

export interface McpListenClient {
  listen(filter: SubscriptionFilter): Promise<McpSubscription>
  subscribeResource(params: { uri: string }): Promise<EmptyResult>
  getServerCapabilities(): { resources?: { subscribe?: boolean | undefined } | undefined } | undefined
}

export function isLegacyProtocolError(error: Error): boolean {
  return SdkError.isInstance(error) && error.code === SdkErrorCode.MethodNotSupportedByProtocolVersion
}

export async function openListening(
  client: McpListenClient,
  uris: string[],
  sessionLost: Promise<McpSourceCloseReason>,
): Promise<McpSourceListening> {
  try {
    const subscription = await client.listen({ resourceSubscriptions: uris })
    return {
      honoredUris: subscription.honoredFilter.resourceSubscriptions ?? [],
      closed: Promise.race([subscription.closed, sessionLost]),
      close: () => subscription.close(),
    }
  } catch (error) {
    const failure = toError(error)
    if (!isLegacyProtocolError(failure)) throw failure
  }
  if (client.getServerCapabilities()?.resources?.subscribe !== true) {
    return { honoredUris: [], closed: sessionLost, close: async () => {} }
  }
  for (const uri of uris) await client.subscribeResource({ uri })
  return { honoredUris: uris, closed: sessionLost, close: async () => {} }
}

function isStreamOpenFailure(error: Error): boolean {
  return SdkError.isInstance(error) && error.code === SdkErrorCode.ClientHttpFailedToOpenStream
}

function textValue(text: string, mimeType: string | undefined): JsonValue {
  const jsonLike = (mimeType !== undefined && /json/i.test(mimeType)) || JSON_LOOKING.test(text)
  return (jsonLike ? safeJsonParse(text) : null) ?? text
}

interface ResourceContent {
  uri: string
  mimeType?: string | undefined
  text?: string | undefined
  blob?: string | undefined
}

export function resourceContentsValue(contents: readonly ResourceContent[]): JsonValue {
  const values = contents.map((content): JsonValue =>
    content.text !== undefined
      ? textValue(content.text, content.mimeType)
      : `[binary resource ${content.mimeType ?? "unknown"}, ${content.blob?.length ?? 0} base64 characters]`,
  )
  return values.length === 1 ? values[0]! : values
}

interface ToolContentBlock {
  type: string
  text?: string | undefined
}

export function toolResultValue<Structured>(result: {
  content?: readonly ToolContentBlock[] | undefined
  structuredContent?: Structured | undefined
  isError?: boolean | undefined
}): JsonValue {
  const text = (result.content ?? [])
    .filter((block) => block.type === "text" && block.text !== undefined)
    .map((block) => block.text ?? "")
    .join("\n")
  if (result.isError) throw new McpToolRejectedError(text.length > 0 ? text : "tool call failed")
  const structured = result.structuredContent === undefined ? null : toJsonValue(result.structuredContent)
  return structured ?? textValue(text, undefined)
}

function withHeaders(headers: Record<string, string>): (url: string | URL, init?: RequestInit) => Promise<Response> {
  return (url, init) => {
    const merged = new Headers(init?.headers)
    for (const [name, value] of Object.entries(headers)) merged.set(name, value)
    return fetch(url, { ...init, headers: merged })
  }
}

export function buildSourceTransport(server: McpServerConfig, bearer: string | undefined): Transport {
  switch (server.transport) {
    case "stdio":
      return new StdioClientTransport({ command: server.command, args: server.args, env: stdioEnv(server), cwd: server.cwd })
    case "http":
      return new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: networkHeaders(server, bearer) } })
    case "sse":
      return new SSEClientTransport(new URL(server.url), { fetch: withHeaders(networkHeaders(server, bearer)) })
    case "ws":
      throw new Error("The ws transport is not supported for MCP sources; use http or sse")
  }
}

export function createClientConnection(client: Client, terminator: SessionTerminator | null = null): McpSourceConnection {
  let closing = false
  let markLost: () => void = () => {}
  const sessionLost = new Promise<McpSourceCloseReason>((resolve) => {
    markLost = () => { resolve(closing ? "local" : "remote") }
  })
  client.onclose = markLost
  client.onerror = (error) => {
    if (isStreamOpenFailure(error)) markLost()
  }
  async function reachable<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation()
    } catch (error) {
      const failure = toError(error)
      if (!ProtocolError.isInstance(failure)) markLost()
      throw failure
    }
  }
  return {
    async listen(uris, onUpdated) {
      client.setNotificationHandler("notifications/resources/updated", (notification) => {
        onUpdated(notification.params.uri)
      })
      return openListening(client, uris, sessionLost)
    },
    async readResource(uri) {
      const result = await reachable(() => client.readResource({ uri }))
      return resourceContentsValue(result.contents)
    },
    async callTool(name, args) {
      try {
        return toolResultValue(await reachable(() => client.callTool({ name, arguments: args })))
      } catch (error) {
        const failure = toError(error)
        throw ProtocolError.isInstance(failure) ? new McpToolRejectedError(failure.message) : failure
      }
    },
    async close() {
      closing = true
      await terminateQuietly(terminator)
      await client.close()
    },
  }
}

export function createMcpSourceConnector(): McpSourceConnector {
  return {
    async open(server, bearer) {
      const client = new Client({ name: "kanna-source", version: APP_VERSION })
      const transport = buildSourceTransport(server, bearer)
      const connection = createClientConnection(client, transport instanceof StreamableHTTPClientTransport ? transport : null)
      try {
        await client.connect(transport, { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) })
      } catch (error) {
        await client.close().catch(() => {})
        throw toError(error)
      }
      return connection
    },
  }
}
