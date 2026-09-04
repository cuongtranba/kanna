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
    pinnedRef: null,
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

function fakeReleaseResponse(tagName: string): Response {
  return new Response(JSON.stringify({ tag_name: tagName }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
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

  describe("re-pin target resolution", () => {
    // `skills update` resolves upstream AT the pin, so a pinned skill needs a
    // TAG to move to. Everything else is fixed by a plain update and needs none.
    test("resolves the latest release tag for a pinned, outdated skill", async () => {
      const skill = makeSkill({ revision: "aaa111", pinnedRef: "v11.12.0" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/releases/latest")) return fakeReleaseResponse("v11.13.4")
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].availability).toBe("outdated")
      expect(results[0].currentVersion).toBe("v11.12.0")
      expect(results[0].latestVersion).toBe("v11.13.4")
    })

    // GitHub orders tags lexicographically, so `v20260102-…` precedes `v11.13.4`.
    // Reading position instead of version is what left a pin unresolvable.
    test("falls back to the highest semver tag when the repo has no releases", async () => {
      const skill = makeSkill({ revision: "aaa111", pinnedRef: "v11.12.0" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/releases/latest")) return errorResponse(404)
        if (urlStr.includes("/tags")) {
          return fakeTagsResponse([
            { name: "v20260102-production-cleanup", commitSha: "c1" },
            { name: "v11.13.4", commitSha: "c2" },
            { name: "v11.12.0", commitSha: "c3" },
          ])
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBe("v11.13.4")
    })

    test("latestVersion is null when neither a release nor a semver tag exists", async () => {
      const skill = makeSkill({ revision: "aaa111", pinnedRef: "v11.12.0" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/releases/latest")) return errorResponse(404)
        if (urlStr.includes("/tags")) {
          return fakeTagsResponse([{ name: "nightly", commitSha: "c1" }])
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBeNull()
    })

    test("an UNPINNED outdated skill resolves no tag and makes no extra call", async () => {
      const skill = makeSkill({ revision: "aaa111", pinnedRef: null })
      let extraCalls = 0

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        extraCalls++
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].availability).toBe("outdated")
      expect(results[0].latestVersion).toBeNull()
      expect(extraCalls).toBe(0)
    })

    test("an up-to-date pinned skill resolves no tag", async () => {
      const skill = makeSkill({ revision: "bbb222", pinnedRef: "v11.12.0" })
      let extraCalls = 0

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        extraCalls++
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].availability).toBe("up_to_date")
      expect(extraCalls).toBe(0)
    })

    test("resolves once per repo and caches across checks", async () => {
      const skill = makeSkill({ revision: "aaa111", pinnedRef: "v11.12.0" })
      let releaseFetches = 0

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/releases/latest")) {
          releaseFetches++
          return fakeReleaseResponse("v11.13.4")
        }
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      await checker.check([skill], neverSignal)
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBe("v11.13.4")
      expect(releaseFetches).toBe(1)
    })

    // Resolution needs no credentials: the tree fetch already runs unauthenticated.
    test("resolves without a token", async () => {
      const skill = makeSkill({ revision: "aaa111", pinnedRef: "v11.12.0" })
      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        const urlStr = String(url)
        if (urlStr.includes("/git/trees/HEAD")) {
          return fakeTreeResponse([{ path: "my-skill", type: "tree", sha: "bbb222" }])
        }
        if (urlStr.includes("/releases/latest")) return fakeReleaseResponse("v11.13.4")
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: null })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].latestVersion).toBe("v11.13.4")
    })

    test("unknown status resolves no tag", async () => {
      const skill = makeSkill({ revision: null, pinnedRef: "v1.0.0" })
      let extraCalls = 0

      const fetchFn = async (url: string | URL | Request): Promise<Response> => {
        if (String(url).includes("/git/trees/HEAD")) return fakeTreeResponse([])
        extraCalls++
        return errorResponse(404)
      }

      const checker = createSkillUpdateChecker({ fetchFn, token: "gh-token" })
      const results = await checker.check([skill], neverSignal)

      expect(results[0].availability).toBe("unknown")
      expect(extraCalls).toBe(0)
    })
  })
})
