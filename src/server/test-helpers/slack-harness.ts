import { createHmac } from "node:crypto"
import type { SlackApi, SlackPostInput, SlackResult, SlackThreadMessage } from "../webhooks/slack/slack-api"
import type { SlackThreadBinding, SlackThreadStorePort } from "../webhooks/slack/slack-threads"

export type SlackCall =
  | { method: "replies"; token: string; channel: string; threadTs: string }
  | { method: "postMessage"; token: string; channel: string; threadTs: string; markdown: string }
  | { method: "addReaction"; token: string; channel: string; ts: string; name: string }
  | { method: "removeReaction"; token: string; channel: string; ts: string; name: string }

export interface FakeSlackApi extends SlackApi {
  calls: SlackCall[]
  failReplies: boolean
  failPost: boolean
  setReplies(channel: string, threadTs: string, messages: SlackThreadMessage[]): void
}

export function slackMessage(ts: string, text: string, user: string | null = "UOWNER000"): SlackThreadMessage {
  return { ts, user, botId: null, text }
}

export function createFakeSlackApi(): FakeSlackApi {
  const scripted = new Map<string, SlackThreadMessage[]>()
  const ok = <T>(value: T): SlackResult<T> => ({ ok: true, value })
  const api: FakeSlackApi = {
    calls: [],
    failReplies: false,
    failPost: false,
    setReplies(channel, threadTs, messages) {
      scripted.set(`${channel}:${threadTs}`, messages)
    },
    async replies(token, channel, threadTs) {
      api.calls.push({ method: "replies", token, channel, threadTs })
      if (api.failReplies) return { ok: false, error: "ratelimited" }
      return ok([...(scripted.get(`${channel}:${threadTs}`) ?? [])])
    },
    async postMessage(token: string, input: SlackPostInput) {
      api.calls.push({ method: "postMessage", token, ...input })
      if (api.failPost) return { ok: false, error: "channel_not_found" }
      return ok({ ts: "1700000999.000100" })
    },
    async addReaction(token, channel, ts, name) {
      api.calls.push({ method: "addReaction", token, channel, ts, name })
      return ok(null)
    },
    async removeReaction(token, channel, ts, name) {
      api.calls.push({ method: "removeReaction", token, channel, ts, name })
      return ok(null)
    },
  }
  return api
}

export function createMemorySlackThreadStore(): SlackThreadStorePort & { saved: SlackThreadBinding[] } {
  const port = {
    saved: [] as SlackThreadBinding[],
    async load() {
      return port.saved.map((binding) => ({ ...binding }))
    },
    async save(bindings: readonly SlackThreadBinding[]) {
      port.saved = bindings.map((binding) => ({ ...binding }))
    },
  }
  return port
}

export function signSlack(secret: string, body: string, timestampSeconds: number): Record<string, string> {
  const timestamp = String(timestampSeconds)
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")
  return { "X-Slack-Signature": `v0=${digest}`, "X-Slack-Request-Timestamp": timestamp }
}
