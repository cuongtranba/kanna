import { describe, expect, test } from "bun:test"
import { createGitHubIssuesProvider } from "./github-issues.adapter"
import type { RemoteSourceRef } from "../shared/boards/types"

const SOURCE: RemoteSourceRef = { provider: "github-issues", owner: "o", repo: "r" }
const AUTH = { token: "t" }

interface Call {
  url: string
  method: string
  body: string | null
}

function stubFetch(payloads: readonly unknown[], init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: Call[] = []
  let index = 0
  const impl = ((input: RequestInfo | URL, request?: RequestInit) => {
    calls.push({
      url: String(input),
      method: request?.method ?? "GET",
      body: typeof request?.body === "string" ? request.body : null,
    })
    const payload = payloads[Math.min(index, payloads.length - 1)]
    index += 1
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      }),
    )
  }) as typeof fetch
  return { impl, calls }
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    number: 412,
    title: "Fix: login redirect loop",
    html_url: "https://github.com/o/r/issues/412",
    body: "Steps",
    state: "open",
    labels: [{ name: "auth" }, { name: "bug" }],
    assignee: { login: "octocat" },
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

describe("pull", () => {
  test("decodes an issue into the provider-neutral shape", async () => {
    const { impl } = stubFetch([[issue()]])
    const result = await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: null,
      limit: 30,
    })
    expect(result.items).toEqual([
      {
        externalId: "412",
        url: "https://github.com/o/r/issues/412",
        title: "Fix: login redirect loop",
        body: "Steps",
        state: "open",
        labels: ["auth", "bug"],
        assignee: "octocat",
        updatedAt: Date.parse("2026-01-01T00:00:00Z"),
      },
    ])
  })

  test("pull requests are filtered out", async () => {
    // The issues endpoint serves PRs too; importing them fills a board with
    // review noise.
    const { impl } = stubFetch([[issue({ number: 1, pull_request: { url: "x" } }), issue({ number: 2 })]])
    const result = await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: null,
      limit: 30,
    })
    expect(result.items.map((item) => item.externalId)).toEqual(["2"])
  })

  test("the cursor advances even when EVERY entry was filtered", async () => {
    // Regression: advancing only on kept items stalls the sync forever on a
    // repo whose oldest-updated entries are all PRs — the next pull re-reads
    // the same page and imports nothing, silently and permanently. Observed
    // against cli/cli, whose first five oldest-updated entries are all PRs.
    const { impl } = stubFetch([
      [
        issue({ number: 1, pull_request: { url: "x" }, updated_at: "2019-10-10T10:00:00Z" }),
        issue({ number: 2, pull_request: { url: "x" }, updated_at: "2019-10-14T21:16:38Z" }),
      ],
    ])
    const result = await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: null,
      limit: 30,
    })
    expect(result.items).toEqual([])
    expect(result.cursor).toBe(new Date(Date.parse("2019-10-14T21:16:38Z")).toISOString())
  })

  test("an empty page leaves the cursor where it was", async () => {
    const { impl } = stubFetch([[]])
    const result = await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: "2026-01-01T00:00:00.000Z",
      limit: 30,
    })
    expect(result.cursor).toBe("2026-01-01T00:00:00.000Z")
  })

  test("sends the cursor as `since` and caps per_page at 100", async () => {
    const { impl, calls } = stubFetch([[]])
    await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: "2026-01-01T00:00:00.000Z",
      limit: 5000,
    })
    expect(calls[0]?.url).toContain("since=2026-01-01T00%3A00%3A00.000Z")
    expect(calls[0]?.url).toContain("per_page=100")
  })

  test("reads the rate limit headers", async () => {
    const { impl } = stubFetch([[]], {
      headers: { "x-ratelimit-remaining": "4996", "x-ratelimit-reset": "1786380764" },
    })
    const result = await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: null,
      limit: 30,
    })
    expect(result.rateLimit).toEqual({ remaining: 4996, resetAt: 1786380764000 })
  })

  test("a failed request throws rather than reporting an empty page", async () => {
    // Reporting [] would advance nothing but ALSO look like "nothing to do",
    // hiding an outage behind a healthy-looking sync.
    const { impl } = stubFetch([{ message: "Bad credentials" }], { status: 401 })
    await expect(
      createGitHubIssuesProvider({ fetchImpl: impl }).pull({ auth: AUTH, source: SOURCE, cursor: null, limit: 30 }),
    ).rejects.toThrow(/401/)
  })

  test("survives entries that are not issues at all", async () => {
    const { impl } = stubFetch([[null, 42, { number: "not-a-number" }, issue({ number: 7 })]])
    const result = await createGitHubIssuesProvider({ fetchImpl: impl }).pull({
      auth: AUTH,
      source: SOURCE,
      cursor: null,
      limit: 30,
    })
    expect(result.items.map((item) => item.externalId)).toEqual(["7"])
  })
})

describe("push", () => {
  test("updates an existing issue with PATCH and reports the remote timestamp", async () => {
    const { impl, calls } = stubFetch([issue({ updated_at: "2026-02-02T00:00:00Z" })])
    const outcomes = await createGitHubIssuesProvider({ fetchImpl: impl }).push({
      auth: AUTH,
      source: SOURCE,
      changes: [{ externalId: "412", title: "Ours", body: "b", state: "closed" }],
    })
    expect(calls[0]?.method).toBe("PATCH")
    expect(calls[0]?.url).toContain("/issues/412")
    expect(outcomes[0]).toEqual({
      ok: true,
      externalId: "412",
      url: "https://github.com/o/r/issues/412",
      // This is what the caller stamps into the watermark to suppress the echo.
      remoteUpdatedAt: Date.parse("2026-02-02T00:00:00Z"),
    })
  })

  test("creates with POST and does not send a state", async () => {
    const { impl, calls } = stubFetch([issue({ number: 900 })])
    await createGitHubIssuesProvider({ fetchImpl: impl }).push({
      auth: AUTH,
      source: SOURCE,
      changes: [{ externalId: null, title: "New", body: null, state: "open" }],
    })
    expect(calls[0]?.method).toBe("POST")
    expect(calls[0]?.body).toBe(JSON.stringify({ title: "New", body: "" }))
  })

  test("classifies which failures are worth retrying", async () => {
    for (const [status, retryable] of [
      [422, false],
      [404, false],
      [403, true],
      [429, true],
      [500, true],
    ] as [number, boolean][]) {
      const { impl } = stubFetch([{ message: "nope" }], { status })
      const outcomes = await createGitHubIssuesProvider({ fetchImpl: impl }).push({
        auth: AUTH,
        source: SOURCE,
        changes: [{ externalId: "1", title: "t", body: null, state: "open" }],
      })
      expect({ status, outcome: outcomes[0] }).toEqual({
        status,
        outcome: { ok: false, retryable, message: expect.stringContaining(String(status)) },
      })
    }
  })
})
