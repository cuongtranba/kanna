export type SlackResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface SlackThreadMessage {
  ts: string
  user: string | null
  botId: string | null
  text: string
}

export interface SlackPostInput {
  channel: string
  threadTs: string
  markdown: string
}

export interface SlackApi {
  replies(token: string, channel: string, threadTs: string): Promise<SlackResult<SlackThreadMessage[]>>
  postMessage(token: string, input: SlackPostInput): Promise<SlackResult<{ ts: string }>>
  addReaction(token: string, channel: string, ts: string, name: string): Promise<SlackResult<null>>
  removeReaction(token: string, channel: string, ts: string, name: string): Promise<SlackResult<null>>
}
