import { errorMessage } from "../../../shared/errors"
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../../../shared/json"
import type { SlackApi, SlackResult, SlackThreadMessage } from "./slack-api"

const API = "https://slack.com/api"
const REPLIES_PAGE_LIMIT = 200
const MAX_REPLY_PAGES = 5

export type SlackFetch = (url: string, init?: RequestInit) => Promise<Response>

export interface SlackFetchOptions {
  fetchImpl?: SlackFetch
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "User-Agent": "kanna-slack" }
}

async function readEnvelope(response: Response): Promise<SlackResult<JsonObject>> {
  if (response.status === 429) {
    return { ok: false, error: `rate_limited (retry after ${response.headers.get("retry-after") ?? "?"}s)` }
  }
  if (!response.ok) return { ok: false, error: `http_${response.status}` }
  const body: JsonValue = await response.json()
  if (!isJsonObject(body)) return { ok: false, error: "invalid_response" }
  if (body.ok !== true) return { ok: false, error: typeof body.error === "string" ? body.error : "unknown_error" }
  return { ok: true, value: body }
}

function decodeMessage(value: JsonValue): SlackThreadMessage | null {
  if (!isJsonObject(value) || typeof value.ts !== "string") return null
  return {
    ts: value.ts,
    user: typeof value.user === "string" ? value.user : null,
    botId: typeof value.bot_id === "string" ? value.bot_id : null,
    text: typeof value.text === "string" ? value.text : "",
  }
}

function nextCursor(body: JsonObject): string | null {
  const meta = body.response_metadata
  return isJsonObject(meta) && typeof meta.next_cursor === "string" && meta.next_cursor.length > 0
    ? meta.next_cursor
    : null
}

export function createSlackApi(options: SlackFetchOptions = {}): SlackApi {
  const doFetch = options.fetchImpl ?? fetch

  async function call(method: string, request: () => Promise<Response>): Promise<SlackResult<JsonObject>> {
    try {
      return await readEnvelope(await request())
    } catch (error) {
      return { ok: false, error: `${method}: ${errorMessage(error)}` }
    }
  }

  function postJson(token: string, method: string, payload: JsonObject): Promise<SlackResult<JsonObject>> {
    return call(method, () =>
      doFetch(`${API}/${method}`, {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      }),
    )
  }

  async function replies(token: string, channel: string, threadTs: string): Promise<SlackResult<SlackThreadMessage[]>> {
    const messages: SlackThreadMessage[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_REPLY_PAGES; page += 1) {
      const query = new URLSearchParams({ channel, ts: threadTs, limit: String(REPLIES_PAGE_LIMIT) })
      if (cursor !== null) query.set("cursor", cursor)
      const result = await call("conversations.replies", () =>
        doFetch(`${API}/conversations.replies?${query.toString()}`, { headers: authHeaders(token) }),
      )
      if (!result.ok) return result
      const entries = isJsonArray(result.value.messages) ? result.value.messages : []
      for (const entry of entries) {
        const message = decodeMessage(entry)
        if (message) messages.push(message)
      }
      cursor = nextCursor(result.value)
      if (cursor === null) break
    }
    return { ok: true, value: messages }
  }

  async function reaction(method: string, token: string, channel: string, ts: string, name: string): Promise<SlackResult<null>> {
    const result = await postJson(token, method, { channel, timestamp: ts, name })
    return result.ok ? { ok: true, value: null } : result
  }

  return {
    replies,
    async postMessage(token, input) {
      const result = await postJson(token, "chat.postMessage", {
        channel: input.channel,
        thread_ts: input.threadTs,
        markdown_text: input.markdown,
      })
      if (!result.ok) return result
      return { ok: true, value: { ts: typeof result.value.ts === "string" ? result.value.ts : "" } }
    },
    addReaction: (token, channel, ts, name) => reaction("reactions.add", token, channel, ts, name),
    removeReaction: (token, channel, ts, name) => reaction("reactions.remove", token, channel, ts, name),
  }
}
