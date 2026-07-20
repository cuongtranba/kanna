/**
 * Tests for api/share.ts — verifies the share snapshot queryFn.
 */

import { describe, expect, test } from "bun:test"
import { fetchShareSnapshot, shareQueryKeys, shareQueryOptions } from "./share"
import { makeFakeHttpPort } from "../adapters/testing/makeFakePorts"

const MOCK_SNAPSHOT = {
  version: 1 as const,
  chatMeta: { id: "c1", title: "Test Chat", model: "claude-3", createdAt: 0 },
  messages: [],
  attachmentsManifest: [],
}

describe("fetchShareSnapshot", () => {
  test("returns ok response with snapshot", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/api/share/abc123",
      response: { ok: true, status: 200, body: { ok: true, snapshot: MOCK_SNAPSHOT } },
    })
    const result = await fetchShareSnapshot("abc123", { http })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshot.chatMeta.id).toBe("c1")
    }
  })

  test("returns error response for not_found", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/api/share/bad-token",
      response: { ok: true, status: 200, body: { ok: false, error: { kind: "not_found" } } },
    })
    const result = await fetchShareSnapshot("bad-token", { http })
    expect(result.ok).toBe(false)
    if (result.ok === false) {
      expect(result.error.kind).toBe("not_found")
    }
  })

  test("URL-encodes the token", async () => {
    const http = makeFakeHttpPort()
    const encodedUrl = `/api/share/${encodeURIComponent("token/with/slashes")}`
    http.routes.push({
      method: "GET",
      url: encodedUrl,
      response: { ok: true, status: 200, body: { ok: false, error: { kind: "not_found" } } },
    })
    await fetchShareSnapshot("token/with/slashes", { http })
    expect(http.calls[0]?.url).toBe(encodedUrl)
  })
})

describe("shareQueryKeys", () => {
  test("byToken builds a stable key", () => {
    expect(shareQueryKeys.byToken("abc")).toEqual(["share", "abc"])
  })
})

describe("shareQueryOptions", () => {
  test("produces staleTime Infinity and retry 0", () => {
    const opts = shareQueryOptions("tok")
    expect(opts.staleTime).toBe(Infinity)
    expect(opts.retry).toBe(0)
    expect(opts.queryKey).toEqual(["share", "tok"])
  })
})
