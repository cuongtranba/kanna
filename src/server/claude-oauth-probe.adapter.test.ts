import { afterEach, expect, test } from "vite-plus/test"
import { testOAuthToken } from "./claude-oauth-probe.adapter"

const API_KEY_STUB = "sk-ant-usr-abcdefghijklmnopqrstuvwxyz1234"

let server: ReturnType<typeof Bun.serve> | null = null

afterEach(async () => {
  await server?.stop(true)
  server = null
})

function startRecordingServer(): { baseUrl: string; headers: Headers[] } {
  const headers: Headers[] = []
  server = Bun.serve({
    port: 0,
    fetch(request) {
      headers.push(request.headers)
      return Response.json({ type: "message" })
    },
  })
  return { baseUrl: `http://127.0.0.1:${server.port}`, headers }
}

test("an API key is probed with x-api-key and no bearer authorization", async () => {
  const { baseUrl, headers } = startRecordingServer()

  const result = await testOAuthToken(API_KEY_STUB, baseUrl)

  expect(result).toEqual({ ok: true, error: null })
  expect(headers).toHaveLength(1)
  expect(headers[0]?.get("x-api-key")).toBe(API_KEY_STUB)
  expect(headers[0]?.has("authorization")).toBe(false)
})
