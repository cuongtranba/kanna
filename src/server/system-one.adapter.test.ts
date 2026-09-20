import { describe, expect, test } from "bun:test"
import { createSystemOneClient, SYSTEM_ONE_ENDPOINT, type SystemOneFetch } from "./system-one.adapter"
import type { SystemOneQuestions } from "../shared/system-one"

const QUESTIONS: SystemOneQuestions = {
  bounded: { type: "noul", instructions: "Is `chunk` one bounded step?" },
}

const WIRE_OK = {
  model: "jev-1.13.0",
  answers: { bounded: { type: "noul", noul: 0.88 } },
  usage: { input_tokens: 42, output_tokens: 1 },
}

interface Seen {
  url: string
  method: string | undefined
  headers: Record<string, string>
  body: string
}

function fakeFetch(responses: (() => Response)[]) {
  const seen: Seen[] = []
  const fetchImpl: SystemOneFetch = async (input, init) => {
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => { headers[key] = value })
    seen.push({
      url: input,
      method: init.method,
      headers,
      body: typeof init.body === "string" ? init.body : "",
    })
    const next = responses.shift()
    if (!next) throw new Error("fetch called more times than scripted")
    return next()
  }
  return { fetchImpl, seen }
}

describe("createSystemOneClient", () => {
  test("posts the encoded request with a bearer key and parses the answers", async () => {
    const { fetchImpl, seen } = fakeFetch([() => Response.json(WIRE_OK)])
    const ask = createSystemOneClient({ apiKey: "ts-test-key", fetchImpl })
    const response = await ask({ state: { chunk: "Extract X" }, questions: QUESTIONS })
    expect(response?.answers.bounded).toEqual({ type: "noul", noul: 0.88 })
    expect(response?.inputTokens).toBe(42)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(SYSTEM_ONE_ENDPOINT)
    expect(seen[0]?.method).toBe("POST")
    expect(seen[0]?.headers.authorization).toBe("Bearer ts-test-key")
    expect(seen[0]?.headers["content-type"]).toBe("application/json")
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({
      model: "jev-latest",
      state: { chunk: "Extract X" },
      questions: { bounded: { type: "noul", instructions: "Is `chunk` one bounded step?" } },
    })
  })

  test("retries once after a 429 or 529 and then succeeds", async () => {
    const { fetchImpl, seen } = fakeFetch([
      () => new Response("slow down", { status: 429 }),
      () => Response.json(WIRE_OK),
    ])
    const ask = createSystemOneClient({ apiKey: "k", fetchImpl, retryDelayMs: 1 })
    const response = await ask({ state: "x", questions: QUESTIONS })
    expect(response?.answers.bounded).toEqual({ type: "noul", noul: 0.88 })
    expect(seen).toHaveLength(2)
  })

  test("gives up after the second overload answer", async () => {
    const { fetchImpl, seen } = fakeFetch([
      () => new Response("", { status: 529 }),
      () => new Response("", { status: 529 }),
    ])
    const ask = createSystemOneClient({ apiKey: "k", fetchImpl, retryDelayMs: 1 })
    await expect(ask({ state: "x", questions: QUESTIONS })).resolves.toBeNull()
    expect(seen).toHaveLength(2)
  })

  test("any other failure answers null instead of throwing", async () => {
    const unauthorized = createSystemOneClient({ apiKey: "k", fetchImpl: fakeFetch([() => new Response("nope", { status: 401 })]).fetchImpl })
    await expect(unauthorized({ state: "x", questions: QUESTIONS })).resolves.toBeNull()

    const malformed = createSystemOneClient({ apiKey: "k", fetchImpl: fakeFetch([() => new Response("not json", { status: 200 })]).fetchImpl })
    await expect(malformed({ state: "x", questions: QUESTIONS })).resolves.toBeNull()

    const offline = createSystemOneClient({
      apiKey: "k",
      fetchImpl: async () => { throw new TypeError("fetch failed") },
    })
    await expect(offline({ state: "x", questions: QUESTIONS })).resolves.toBeNull()
  })

  test("a request that outlives the timeout is aborted and answers null", async () => {
    const fetchImpl: SystemOneFetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    const ask = createSystemOneClient({ apiKey: "k", fetchImpl, timeoutMs: 20 })
    const startedAt = Date.now()
    await expect(ask({ state: "x", questions: QUESTIONS })).resolves.toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })
})
