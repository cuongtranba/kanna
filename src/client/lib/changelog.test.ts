import { afterEach, describe, expect, test } from "vite-plus/test"
import {
  compareSemverTags,
  getCachedChangelog,
  loadChangelog,
  normalizeVersionTag,
  releaseAction,
  resetChangelogCache,
  setCachedChangelog,
} from "./changelog"

const SAMPLE_RELEASES = [
  {
    id: 1,
    name: "v0.8.1",
    tag_name: "v0.8.1",
    html_url: "https://github.com/cuongtranba/kanna/releases/tag/v0.8.1",
    published_at: "2026-03-19T16:53:08Z",
    body: "## Improvements\n- Better cursor color",
    prerelease: false,
    draft: false,
  },
  {
    id: 2,
    name: null,
    tag_name: "v0.9.0-beta.1",
    html_url: "https://github.com/cuongtranba/kanna/releases/tag/v0.9.0-beta.1",
    published_at: "2026-03-20T12:00:00Z",
    body: "",
    prerelease: true,
    draft: false,
  },
]

afterEach(() => {
  resetChangelogCache()
})

describe("loadChangelog", () => {
  test("returns releases from the injected fetcher on a cold cache", async () => {
    const releases = await loadChangelog(async () => [SAMPLE_RELEASES[0]])
    expect(releases).toEqual([SAMPLE_RELEASES[0]])
  })

  test("propagates fetcher errors", async () => {
    await expect(
      loadChangelog(async () => {
        throw new Error("GitHub releases request failed with status 403")
      })
    ).rejects.toThrow("GitHub releases request failed with status 403")
  })
})

describe("changelog cache", () => {
  test("reuses cached releases inside the ttl window", () => {
    setCachedChangelog([SAMPLE_RELEASES[0]], () => 1_000)

    expect(getCachedChangelog(() => 1_000)).toEqual([SAMPLE_RELEASES[0]])
    expect(getCachedChangelog(() => 1_000 + 4 * 60 * 1000)).toEqual([SAMPLE_RELEASES[0]])
  })

  test("expires cached releases after the ttl window", () => {
    setCachedChangelog([SAMPLE_RELEASES[0]], () => 2_000)

    expect(getCachedChangelog(() => 2_000 + 5 * 60 * 1000 + 1)).toBeNull()
  })

  test("force refresh bypasses the in-memory cache", async () => {
    setCachedChangelog([SAMPLE_RELEASES[0]])

    const releases = await loadChangelog(async () => [SAMPLE_RELEASES[1]], { force: true })

    expect(releases).toEqual([SAMPLE_RELEASES[1]])
  })
})

describe("normalizeVersionTag", () => {
  test("strips whitespace and one leading v", () => {
    expect(normalizeVersionTag(" v1.2.3 ")).toBe("1.2.3")
    expect(normalizeVersionTag("V1.2.3")).toBe("1.2.3")
    expect(normalizeVersionTag("1.2.3")).toBe("1.2.3")
  })
})

describe("compareSemverTags", () => {
  test("orders tags numerically and ignores the v prefix and prerelease suffix", () => {
    expect(compareSemverTags("v1.10.0", "v1.9.0")).toBe(1)
    expect(compareSemverTags("1.0.0", "v1.0.0")).toBe(0)
    expect(compareSemverTags("v0.9.0-beta.1", "0.9.0")).toBe(0)
    expect(compareSemverTags("v1.0", "v1.0.1")).toBe(-1)
  })
})

describe("releaseAction", () => {
  test("the latest release is an update", () => {
    expect(releaseAction("v1.2.0", "1.1.0", "v1.2.0")).toEqual({ actionLabel: "Update", pendingLabel: "Updating…" })
  })

  test("an older release than the current version is a rollback", () => {
    expect(releaseAction("v1.0.0", "1.1.0", "1.2.0")).toEqual({ actionLabel: "Rollback", pendingLabel: "Rolling back…" })
  })

  test("a newer release that is not the latest is an install", () => {
    expect(releaseAction("v1.1.5", "1.1.0", "1.2.0")).toEqual({ actionLabel: "Install", pendingLabel: "Installing…" })
  })
})
