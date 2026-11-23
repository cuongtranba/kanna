import { expect, test } from "vite-plus/test"
import { isJsonArray, isJsonObject, objectField, stringField, type JsonObject, type JsonValue } from "../shared/json"
import { AGENT_TOOLS_MCP_PATH, AgentToolsBridge } from "./agent-tools-bridge"
import type { CodexKannaTools } from "./codex-dynamic-tool-call"

const PEER_TOOL_NAMES = ["list_peer_chats", "send_chat_message", "wait_for_chat_message"]
const URL_OF_BRIDGE = new URL(`http://127.0.0.1:4242${AGENT_TOOLS_MCP_PATH}`)
const PING = { jsonrpc: "2.0", id: 1, method: "ping" }

function fakeTools(attributedTo: string[]): CodexKannaTools {
  return {
    specs: PEER_TOOL_NAMES.map((name) => ({ type: "function", name, description: `${name} tool`, inputSchema: { type: "object" } })),
    call: async (chatId, tool) => {
      attributedTo.push(chatId)
      return { text: `answered ${tool} for ${chatId}`, isError: false }
    },
  }
}

function boundBridge(attributedTo: string[] = []): AgentToolsBridge {
  const bridge = new AgentToolsBridge(fakeTools(attributedTo))
  bridge.bindPort(4242)
  return bridge
}

function bearerOf(server: JsonObject): string {
  const headers = server.headers
  const first = headers !== undefined && isJsonArray(headers) ? headers[0] : undefined
  const value = first !== undefined && isJsonObject(first) ? stringField(first, "value") : undefined
  return value?.replace("Bearer ", "") ?? ""
}

function post(bridge: AgentToolsBridge, token: string | null, body: JsonValue, socketIp = "127.0.0.1", extra: Record<string, string> = {}) {
  const headers = { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...extra }
  return bridge.handle(new Request(URL_OF_BRIDGE, { method: "POST", headers, body: JSON.stringify(body) }), URL_OF_BRIDGE, socketIp, () => {})
}

async function resultOf(response: Response | null): Promise<JsonObject> {
  const body: JsonValue = response === null ? null : await response.json()
  return body !== null && isJsonObject(body) ? objectField(body, "result") ?? {} : {}
}

test("a granted bearer completes initialize, tools/list and tools/call, attributed to the granted chat only", async () => {
  const attributedTo: string[] = []
  const bridge = boundBridge(attributedTo)
  const grant = bridge.grant("chat-7", () => {})
  const token = bearerOf(grant?.server ?? {})

  const init = await resultOf(await post(bridge, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }))
  const list = await resultOf(await post(bridge, token, { jsonrpc: "2.0", id: 2, method: "tools/list" }))
  const call = await resultOf(await post(bridge, token, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "list_peer_chats", arguments: { chatId: "someone-else" } },
  }))

  expect(init).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "kanna" } })
  expect(list.tools).toMatchObject(PEER_TOOL_NAMES.map((name) => ({ name })))
  expect(call).toEqual({ content: [{ type: "text", text: "answered list_peer_chats for chat-7" }], isError: false })
  expect(attributedTo).toEqual(["chat-7"])
})

test("a missing, unknown or revoked bearer is refused with 401 and an empty body", async () => {
  const bridge = boundBridge()
  const grant = bridge.grant("chat-1", () => {})
  const token = bearerOf(grant?.server ?? {})
  grant?.revoke()

  const responses = await Promise.all([post(bridge, null, PING), post(bridge, "not-a-granted-token", PING), post(bridge, token, PING)])

  expect(responses.map((response) => response?.status)).toEqual([401, 401, 401])
  expect(await Promise.all(responses.map((response) => response?.text()))).toEqual(["", "", ""])
})

test("a valid bearer is still refused from a non-loopback address or a browser origin, and GET is not allowed", async () => {
  const bridge = boundBridge()
  const token = bearerOf(bridge.grant("chat-1", () => {})?.server ?? {})

  const remote = await post(bridge, token, PING, "203.0.113.9")
  const browser = await post(bridge, token, PING, "127.0.0.1", { origin: "https://evil.example" })
  const get = await bridge.handle(new Request(URL_OF_BRIDGE, { method: "GET" }), URL_OF_BRIDGE, "127.0.0.1", () => {})

  expect([remote?.status, browser?.status, get?.status]).toEqual([403, 403, 405])
})
