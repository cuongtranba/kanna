import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../../../shared/json"

export type SlackEnvelope =
  | { kind: "url_verification"; challenge: string }
  | { kind: "event_callback"; eventId: string; teamId: string; botUserId: string | null; event: JsonObject }
  | { kind: "other" }

export type SlackEventCallback = Extract<SlackEnvelope, { kind: "event_callback" }>

export interface SlackMention {
  channel: string
  ts: string
  threadTs: string
  user: string
  text: string
}

export type SlackClassification =
  | { kind: "accept"; mention: SlackMention }
  | { kind: "ignore"; reason: string }

function botUserOf(body: JsonObject): string | null {
  const authorizations = body.authorizations
  if (!isJsonArray(authorizations)) return null
  const first = authorizations[0]
  return first !== undefined && isJsonObject(first) && typeof first.user_id === "string" ? first.user_id : null
}

export function parseSlackEnvelope(body: JsonValue): SlackEnvelope {
  if (!isJsonObject(body)) return { kind: "other" }
  if (body.type === "url_verification" && typeof body.challenge === "string") {
    return { kind: "url_verification", challenge: body.challenge }
  }
  const { event_id: eventId, team_id: teamId, event } = body
  if (body.type !== "event_callback" || typeof eventId !== "string" || typeof teamId !== "string") {
    return { kind: "other" }
  }
  if (!isJsonObject(event)) return { kind: "other" }
  return { kind: "event_callback", eventId, teamId, botUserId: botUserOf(body), event }
}

function ignore(reason: string): SlackClassification {
  return { kind: "ignore", reason }
}

export function classifySlackEvent(
  envelope: SlackEventCallback,
  allowedUserIds: readonly string[],
): SlackClassification {
  const { event } = envelope
  if (event.type !== "app_mention") return ignore(`event type ${String(event.type)}`)
  if (event.bot_id !== undefined) return ignore("message from a bot")
  if (event.subtype !== undefined) return ignore(`message subtype ${String(event.subtype)}`)
  if (event.edited !== undefined) return ignore("edited message")
  const { channel, ts, user, text } = event
  if (typeof channel !== "string" || typeof ts !== "string" || typeof user !== "string" || typeof text !== "string") {
    return ignore("malformed app_mention")
  }
  if (!allowedUserIds.includes(user)) return ignore(`user ${user} is not allowed`)
  const threadTs = typeof event.thread_ts === "string" ? event.thread_ts : ts
  return { kind: "accept", mention: { channel, ts, threadTs, user, text } }
}

const ANGLE_TOKEN = /<([^<>]+)>/g

function decodeToken(token: string): string {
  const [target, label] = token.split("|", 2)
  if (target.startsWith("@")) return `@${label ?? target.slice(1)}`
  if (target.startsWith("#")) return `#${label ?? target.slice(1)}`
  if (target.startsWith("!")) {
    if (label !== undefined) return label
    const name = target.slice(1).split("^")[0]
    return `@${name}`
  }
  return label !== undefined ? `${label} (${target})` : target
}

export function decodeSlackText(text: string): string {
  return text
    .replace(ANGLE_TOKEN, (_match, token: string) => decodeToken(token))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

export function stripBotMention(text: string, botUserId: string | null): string {
  const mention = botUserId === null ? /^\s*<@[A-Z0-9]+(?:\|[^>]*)?>/ : new RegExp(`<@${botUserId}(?:\\|[^>]*)?>`, "g")
  return text.replace(mention, "").trim()
}
