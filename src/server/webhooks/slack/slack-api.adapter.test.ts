import { expect, test } from "bun:test"
import { createSlackApi, type SlackFetch } from "./slack-api.adapter"

interface Call {
  url: string
  method: string
  authorization: string | null
  body: string | null
}

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Call[] = []
  const impl: SlackFetch = async (url, init) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    return next
  }
  return { impl, calls }
}

const slackOk = (fields: Record<string, string | boolean | object>) => Response.json({ ok: true, ...fields })

test("a reply is posted as markdown_text into the thread with the bot token", async () => {
  const { impl, calls } = fakeFetch([slackOk({ ts: "1.1" })])
  const result = await createSlackApi({ fetchImpl: impl }).postMessage("xoxb-token", { channel: "C1", threadTs: "1.0", markdown: "**done**" })
  expect(result).toEqual({ ok: true, value: { ts: "1.1" } })
  expect(calls).toHaveLength(1)
  expect(calls[0].url).toBe("https://slack.com/api/chat.postMessage")
  expect(calls[0].authorization).toBe("Bearer xoxb-token")
  expect(JSON.parse(calls[0].body ?? "")).toEqual({ channel: "C1", thread_ts: "1.0", markdown_text: "**done**" })
})

test("a Slack error, a rate limit and a network failure all come back as errors", async () => {
  const input = { channel: "C1", threadTs: "1.0", markdown: "x" }
  const slackError = fakeFetch([Response.json({ ok: false, error: "channel_not_found" })])
  expect(await createSlackApi({ fetchImpl: slackError.impl }).postMessage("t", input)).toEqual({ ok: false, error: "channel_not_found" })
  const limited = fakeFetch([new Response("slow down", { status: 429, headers: { "retry-after": "30" } })])
  const rateLimited = await createSlackApi({ fetchImpl: limited.impl }).postMessage("t", input)
  expect(rateLimited.ok === false && rateLimited.error.startsWith("rate_limited")).toBe(true)
  const broken = fakeFetch([new Error("offline")])
  const offline = await createSlackApi({ fetchImpl: broken.impl }).postMessage("t", input)
  expect(offline.ok === false && offline.error.includes("offline")).toBe(true)
})

test("thread replies follow the pagination cursor and keep only well-formed messages", async () => {
  const { impl, calls } = fakeFetch([
    slackOk({ messages: [{ ts: "1.0", user: "U1", text: "a" }, { nope: true }], response_metadata: { next_cursor: "page2" } }),
    slackOk({ messages: [{ ts: "2.0", bot_id: "B1", text: "b" }] }),
  ])
  const result = await createSlackApi({ fetchImpl: impl }).replies("t", "C1", "1.0")
  expect(result).toEqual({
    ok: true,
    value: [
      { ts: "1.0", user: "U1", botId: null, text: "a" },
      { ts: "2.0", user: null, botId: "B1", text: "b" },
    ],
  })
  expect(calls[0].method).toBe("GET")
  expect(calls[1].url).toContain("cursor=page2")
})

test("a reaction is added and removed through the reactions API", async () => {
  const { impl, calls } = fakeFetch([slackOk({})])
  const api = createSlackApi({ fetchImpl: impl })
  expect(await api.addReaction("t", "C1", "1.0", "eyes")).toEqual({ ok: true, value: null })
  await api.removeReaction("t", "C1", "1.0", "eyes")
  expect(calls.map((call) => call.url)).toEqual(["https://slack.com/api/reactions.add", "https://slack.com/api/reactions.remove"])
  expect(JSON.parse(calls[0].body ?? "")).toEqual({ channel: "C1", timestamp: "1.0", name: "eyes" })
})
