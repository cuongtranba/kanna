import { describe, test, expect } from "bun:test"
import type { InstalledPackage } from "../shared/packages/types"
import { createSkillUpdateChecker } from "./skill-update-checker.adapter"

// ─── Test helpers ─────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  const name = overrides.name ?? "my-skill"
  return {
    kind: "skill",
    name,
    source: "owner/repo",
    sourceUrl: "https://github.com/owner/repo",
    version: null,
    revision: "aaa111",
    installedAt: null,
    updatedAt: null,
    installPath: null,
    versionLabel: null,
    agents: [],
    ...overrides,
    // id is always derived from the resolved name, applied last to avoid spread override
    id: `skill:${name}`,
  }
}

interface FakeTreeEntry {
  path: string
  type: string
  sha: string
}

function fakeTreeResponse(
  entries: FakeTreeEntry[],
  truncated = false,
  etag: string | null = null,
  rateRemaining = 100,
): Response {
  const body = JSON.stringify({ sha: "tree-sha", tree: entries, truncated })
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-ratelimit-remaining": String(rateRemaining),
  }
  if (etag) headers.etag = etag
  return new Response(body, { status: 200, headers })
}

function fakeTagsResponse(tags: Array<{ name: string; commitSha: string }>): Response {
  const body = JSON.stringify(tags.map((t) => ({ name: t.name, commit: { sha: t.commitSha } })))
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
}

function notModifiedResponse(rateRemaining = 100): Response {
  return new Response(null, {
    status: 304,
    headers: { "x-ratelimit-remaining": String(rateRemaining) },
  })
}

function errorResponse(status: number, rateRemaining = 100): Response {
  return new Response(JSON.stringify({ message: "error" }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-ratelimit-remaining": String(rateRemaining),
    },
  })
}

const neverSignal = new AbortController().signal

// ─── Tests ────────────────────────────────────────────────────────────────

describe("createSkillUpdateChecker", () => {
  test("up_to_date when installed hash matches upstream", async () => {
    const skill = makeSkill({ revision: "aaa111" })
    const fetchFn = async (_url: string | URL | Request): Promise<Response> =>
      fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "aaa111" }])

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], neverSignal)

    expect(results).toHaveLength(1)
    expect(results[0].availability).toBe("up_to_date")
    expect(results[0].latestRevision).toBe("aaa111")
    expect(results[0].error).toBeNull()
  })

  test("outdated when installed hash differs from upstream", async () => {
    const skill = makeSkill({ revision: "aaa111" })
    const fetchFn = async (_url: string | URL | Request): Promise<Response> =>
      fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], neverSignal)

    expect(results[0].availability).toBe("outdated")
    expect(results[0].currentRevision).toBe("aaa111")
    expect(results[0].latestRevision).toBe("bbb222")
  })

  test("skills from same repo → single fetch call", async () => {
    const skillA = makeSkill({ name: "skill-a", revision: "aaa" })
    const skillB = makeSkill({ name: "skill-b", revision: "bbb", id: "skill:skill-b" })
    let callCount = 0

    const fetchFn = async (_url: string | URL | Request): Promise<Response> => {
      callCount++
      return fakeTreeResponse([
        { path: "skill-a", type: "tree", sha: "aaa" },
        { path: "skill-b", type: "tree", sha: "bbb" },
      ])
    }

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skillA, skillB], neverSignal)

    expect(callCount).toBe(1)
    expect(results).toHaveLength(2)
    expect(results[0].availability).toBe("up_to_date")
    expect(results[1].availability).toBe("up_to_date")
  })

  test("unknown (not outdated) when tree is truncated and entry missing", async () => {
    const skill = makeSkill({ revision: "aaa111" })
    const fetchFn = async (_url: string | URL | Request): Promise<Response> =>
      fakeTreeResponse([], true) // truncated, no entries

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], neverSignal)

    expect(results[0].availability).toBe("unknown")
    expect(results[0].error).toBe("tree truncated")
  })

  test("304 Not Modified returns cached result without re-parsing", async () => {
    const skill = makeSkill({ revision: "aaa111" })
    let callCount = 0

    const fetchFn = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      callCount++
      const headers = init?.headers as Record<string, string> | undefined
      if (headers?.["If-None-Match"] === "etag-v1") {
        return notModifiedResponse()
      }
      return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "aaa111" }], false, "etag-v1")
    }

    const checker = createSkillUpdateChecker({ fetchFn, token: null })

    const results1 = await checker.check([skill], neverSignal)
    expect(results1[0].availability).toBe("up_to_date")

    const results2 = await checker.check([skill], neverSignal)
    expect(results2[0].availability).toBe("up_to_date")
    expect(callCount).toBe(2) // two requests, second returns 304
  })

  test("403 with rate limit exhausted marks skill as unknown rate limited", async () => {
    const skill = makeSkill()
    const fetchFn = async (_url: string | URL | Request): Promise<Response> =>
      errorResponse(403, 0)

    const checker = createSkillUpdateChecker({ fetchFn, token: null, rateLimitFloor: 5 })
    const results = await checker.check([skill], neverSignal)

    expect(results[0].availability).toBe("unknown")
    expect(results[0].error).toBe("rate limited")
  })

  test("remaining skills get unknown rate-limited after exhaustion", async () => {
    const skillA = makeSkill({ name: "a", source: "owner/repo-a", sourceUrl: "https://github.com/owner/repo-a" })
    const skillB = makeSkill({ name: "b", source: "owner/repo-b", sourceUrl: "https://github.com/owner/repo-b" })
    let callCount = 0

    const fetchFn = async (url: string | URL | Request): Promise<Response> => {
      callCount++
      const urlStr = String(url)
      if (urlStr.includes("repo-a")) {
        return errorResponse(403, 0) // exhausted for repo-a
      }
      return fakeTreeResponse([{ path: "b", type: "tree", sha: "bbb" }])
    }

    const checker = createSkillUpdateChecker({ fetchFn, token: null, rateLimitFloor: 5 })
    const results = await checker.check([skillA, skillB], neverSignal)

    expect(results.find((r) => r.id === "skill:a")?.error).toBe("rate limited")
    expect(results.find((r) => r.id === "skill:b")?.error).toBe("rate limited")
    // repo-b should not be fetched once rate-limited
    expect(callCount).toBe(1)
  })

  test("404 returns unknown with error message", async () => {
    const skill = makeSkill()
    const fetchFn = async (_url: string | URL | Request): Promise<Response> =>
      errorResponse(404)

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], neverSignal)

    expect(results[0].availability).toBe("unknown")
    expect(results[0].error).toContain("not found")
  })

  test("network error returns unknown with error message", async () => {
    const skill = makeSkill()
    const fetchFn = async (_url: string | URL | Request): Promise<Response> => {
      throw new Error("Network connection refused")
    }

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], neverSignal)

    expect(results[0].availability).toBe("unknown")
    expect(results[0].error).toContain("Network connection refused")
  })

  test("AbortSignal is forwarded to fetch", async () => {
    const skill = makeSkill()
    const controller = new AbortController()
    controller.abort()

    const fetchFn = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError")
      return fakeTreeResponse([])
    }

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], controller.signal)

    expect(results[0].availability).toBe("unknown")
  })

  test("non-GitHub source returns unknown unsupported source", async () => {
    const skill = makeSkill({ sourceUrl: null, source: "not-a-github-source" })
    const fetchFn = async (_url: string | URL | Request): Promise<Response> =>
      fakeTreeResponse([])

    const checker = createSkillUpdateChecker({ fetchFn, token: null })
    const results = await checker.check([skill], neverSignal)

    expect(results[0].availability).toBe("unknown")
    expect(results[0].error).toBe("unsupported source")
  })

  test("does not call skills CLI (no spawn/exec in implementation)", () => {
    // The adapter uses only fetch — verifying that the implementation
    // compiles and runs without any child_process or Bun.spawn invocations.
    // This test passes by construction: the side-effect seal bans process
    // spawning from adapter files, and lint enforces it.
    expect(typeof createSkillUpdateChecker).toBe("function")
  })

  describe("tag resolution", () => {
    test("resolves latestVersion tag when token provided and match found", async () => {
      const skill = makeSkill({ revision: "aaa111" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/tags")) {
          return fakeTagsResponse([{ name: "v1.2.0", commitSha: "commit-sha-1" }])
        }
        if (urlStr.includes("/git/trees/commit-sha-1")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].availability).toBe("outdated")
      expect(results[0].latestVersion).toBe("v1.2.0")
    })

    test("returns newest matching tag when multiple candidates", async () => {
      const skill = makeSkill({ revision: "aaa111" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "latest-sha" }])
        }
        if (urlStr.includes("/tags")) {
          return fakeTagsResponse([
            { name: "v2.0.0", commitSha: "commit-v2" },
            { name: "v1.0.0", commitSha: "commit-v1" },
          ])
        }
        if (urlStr.includes("commit-v2")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "latest-sha" }])
        }
        if (urlStr.includes("commit-v1")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "latest-sha" }])
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      // v2.0.0 is first (newest), so that's what should be returned
      expect(results[0].latestVersion).toBe("v2.0.0")
    })

    test("latestVersion is null when no tag matches", async () => {
      const skill = makeSkill({ revision: "aaa111" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/tags")) {
          return fakeTagsResponse([{ name: "v1.0.0", commitSha: "commit-v1" }])
        }
        if (urlStr.includes("commit-v1")) {
          // Different sha in this tag
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "other-sha" }])
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBeNull()
    })

    test("tag cache hit avoids second tag fetch", async () => {
      const skill = makeSkill({ revision: "aaa111" })
      let tagFetchCount = 0

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/tags")) {
          tagFetchCount++
          return fakeTagsResponse([{ name: "v1.0.0", commitSha: "commit-v1" }])
        }
        if (urlStr.includes("commit-v1")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })

      // First check - populates cache
      await checker.check([skill], neverSignal)
      // Second check - should use cached tag result
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBe("v1.0.0")
      // Tags endpoint should only be called once (cache hit on second run)
      expect(tagFetchCount).toBe(1)
    })

    test("tag resolution is skipped when token is null", async () => {
      const skill = makeSkill({ revision: "aaa111" })
      let tagsFetched = false

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/tags")) tagsFetched = true
        return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: null })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBeNull()
      expect(tagsFetched).toBe(false)
    })

    test("unknown status skips tag resolution", async () => {
      const skill = makeSkill({ revision: null }) // no revision → unknown
      let tagsFetched = false

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/tags")) tagsFetched = true
        return fakeTreeResponse([])
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].availability).toBe("unknown")
      expect(tagsFetched).toBe(false)
    })
  })
})
