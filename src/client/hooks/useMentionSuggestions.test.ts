import { afterEach, describe, expect, test } from "bun:test"
import { fetchProjectPaths, type ProjectPath } from "./useMentionSuggestions"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("fetchProjectPaths", () => {
  test("requests the expected URL and returns paths", async () => {
    let receivedUrl: string | null = null as string | null
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      receivedUrl = typeof input === "string" ? input : input.toString()
      return new Response(
        JSON.stringify({ paths: [{ path: "a.ts", kind: "file" }] satisfies ProjectPath[] }),
        { headers: { "Content-Type": "application/json" } },
      )
    }) as typeof fetch

    const result = await fetchProjectPaths({ projectId: "p1", query: "a", signal: new AbortController().signal })
    expect(receivedUrl).toBe("/api/projects/p1/paths?query=a")
    expect(result).toEqual([{ path: "a.ts", kind: "file" }])
  })

  test("escapes query", async () => {
    let receivedUrl: string | null = null as string | null
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      receivedUrl = typeof input === "string" ? input : input.toString()
      return new Response(JSON.stringify({ paths: [] }), { headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    await fetchProjectPaths({ projectId: "p1", query: "a b/c", signal: new AbortController().signal })
    expect(receivedUrl).toBe("/api/projects/p1/paths?query=a+b%2Fc")
  })

  test("returns empty array on non-ok response", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch
    const result = await fetchProjectPaths({ projectId: "p1", query: "x", signal: new AbortController().signal })
    expect(result).toEqual([])
  })
})
