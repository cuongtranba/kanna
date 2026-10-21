import { handleWebhookRequest } from "../webhooks/webhook-http-routes"
import { createWebhookHarness } from "./webhook-harness"
import { signSlack } from "./slack-harness"

export const SLACK_SECRET = "slack-signing-secret-value"
export const SLACK_BOT_TOKEN = "xoxb-test-bot-token"
export const SLACK_OWNER = "UOWNER000"
export const SLACK_BOT_USER = "UBOT00000"
export const SLACK_CHANNEL = "C0CHANNEL"
export const SLACK_NOW_MS = 1_700_000_100_000

export interface MentionOptions {
  eventId: string
  ts: string
  text?: string
  user?: string
  threadTs?: string
  event?: Record<string, string | boolean | object>
}

export function mentionBody(options: MentionOptions): string {
  return JSON.stringify({
    type: "event_callback",
    event_id: options.eventId,
    team_id: "T0TEAM",
    authorizations: [{ user_id: SLACK_BOT_USER }],
    event: {
      type: "app_mention",
      channel: SLACK_CHANNEL,
      ts: options.ts,
      user: options.user ?? SLACK_OWNER,
      text: options.text ?? `<@${SLACK_BOT_USER}> do the thing`,
      ...(options.threadTs ? { thread_ts: options.threadTs } : {}),
      ...options.event,
    },
  })
}

export async function createSlackHookHarness() {
  const harness = await createWebhookHarness({ tapStore: true, now: () => SLACK_NOW_MS })
  const created = await harness.registry.create({
    name: "Slack",
    kind: "slack",
    mode: "spawn",
    projectId: harness.project.id,
    template: "",
    slack: { allowedUserIds: [SLACK_OWNER], signingSecret: SLACK_SECRET, botToken: SLACK_BOT_TOKEN },
  })
  if (!created.ok) throw new Error(created.errors.join())
  const { hook } = created.value
  const post = (body: string, headers: Record<string, string> = signSlack(SLACK_SECRET, body, SLACK_NOW_MS / 1000)) => {
    const url = new URL(`http://localhost/hooks/${hook.id}`)
    return handleWebhookRequest(new Request(url, { method: "POST", headers, body }), url, harness.service)
  }
  const spawnedChats = () => harness.store.listChatsByProject(harness.project.id).filter((chat) => chat.id !== harness.chat.id)
  const lastDelivery = () => harness.registry.snapshot().hooks[0].lastDelivery
  return { ...harness, hook, post, spawnedChats, lastDelivery }
}
