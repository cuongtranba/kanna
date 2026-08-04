import { describe, expect, test } from "bun:test"
import type { RawCatalogEntry } from "./local-catalog-io.adapter"
import type { LocalCatalogScanner } from "./local-catalog"
import { LocalCatalogService, catalogRootDirs, reduceCatalog } from "./local-catalog"

function raw(partial: Partial<RawCatalogEntry> & Pick<RawCatalogEntry, "name" | "kind" | "scope">): RawCatalogEntry {
  return {
    displayName: partial.name,
    description: "",
    argumentHint: "",
    userInvocable: true,
    pluginName: null,
    filePath: `/tmp/${partial.name}`,
    mtimeMs: 0,
    ...partial,
  }
}

describe("reduceCatalog", () => {
  test("project skill beats personal skill of the same name", () => {
    const out = reduceCatalog([
      raw({ name: "deploy", kind: "skill", scope: "personal", description: "p" }),
      raw({ name: "deploy", kind: "skill", scope: "project", description: "proj" }),
    ])
    expect(out).toEqual([
      { name: "deploy", description: "proj", argumentHint: "", kind: "skill", scope: "project" },
    ])
  })

  test("skill beats command at the same scope", () => {
    const out = reduceCatalog([
      raw({ name: "deploy", kind: "command", scope: "project", description: "cmd" }),
      raw({ name: "deploy", kind: "skill", scope: "project", description: "skl" }),
    ])
    expect(out[0]!.kind).toBe("skill")
    expect(out[0]!.description).toBe("skl")
  })

  test("personal beats plugin", () => {
    const out = reduceCatalog([
      raw({ name: "x", kind: "skill", scope: "plugin" }),
      raw({ name: "x", kind: "skill", scope: "personal" }),
    ])
    expect(out[0]!.scope).toBe("personal")
  })

  test("user-invocable: false hides entry", () => {
    const out = reduceCatalog([
      raw({ name: "hidden", kind: "skill", scope: "project", userInvocable: false }),
      raw({ name: "visible", kind: "skill", scope: "project" }),
    ])
    expect(out.map((e) => e.name)).toEqual(["visible"])
  })

  test("sorted by name", () => {
    const out = reduceCatalog([
      raw({ name: "zoo", kind: "skill", scope: "project" }),
      raw({ name: "apple", kind: "skill", scope: "project" }),
      raw({ name: "mango", kind: "skill", scope: "project" }),
    ])
    expect(out.map((e) => e.name)).toEqual(["apple", "mango", "zoo"])
  })

  test("plugin entries with colon names stay sorted", () => {
    const out = reduceCatalog([
      raw({ name: "devops:audit", kind: "command", scope: "plugin", pluginName: "devops" }),
      raw({ name: "c3", kind: "skill", scope: "personal" }),
    ])
    expect(out.map((e) => e.name)).toEqual(["c3", "devops:audit"])
  })
})

describe("catalogRootDirs", () => {
  test("lists the project and personal roots the scanner walks", () => {
    const roots = catalogRootDirs({ cwd: "/proj", homeDir: "/home/u" })
    expect(roots).toEqual([
      "/proj/.claude/skills",
      "/proj/.claude/commands",
      "/home/u/.claude/skills",
      "/home/u/.claude/commands",
      "/home/u/.claude/plugins",
    ])
  })
})

/**
 * Builds a service whose freshness stamps are driven by a mutable map, so a
 * test can simulate "a file on disk changed" without touching a real disk.
 */
function makeStampedService(scan: LocalCatalogScanner, opts?: { ttl?: number; now?: () => number }) {
  const mtimes = new Map<string, number>()
  let statCalls = 0
  const svc = new LocalCatalogService({
    scan,
    homeDir: "/home/u",
    statMtimes: (paths) => {
      statCalls += 1
      return paths.map((p) => mtimes.get(p) ?? 0)
    },
    cacheTtlMs: opts?.ttl,
    now: opts?.now,
  })
  return { svc, mtimes, statCalls: () => statCalls }
}

describe("LocalCatalogService freshness", () => {
  test("serves from cache while every stamp is unchanged", () => {
    let calls = 0
    const { svc, mtimes, statCalls } = makeStampedService(() => {
      calls += 1
      return [raw({ name: `n-${calls}`, kind: "skill", scope: "project", filePath: "/proj/.claude/skills/a/SKILL.md" })]
    })
    mtimes.set("/proj/.claude/skills", 10)
    mtimes.set("/proj/.claude/skills/a/SKILL.md", 20)

    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])
    expect(calls).toBe(1)
    // One stamp-read on the miss, one validation on the hit: the hit is earned
    // by re-stat'ing, not assumed from the clock.
    expect(statCalls()).toBe(2)
  })

  test("rescans when a scanned file's mtime changes", () => {
    let calls = 0
    const { svc, mtimes } = makeStampedService(() => {
      calls += 1
      return [raw({ name: `n-${calls}`, kind: "skill", scope: "project", filePath: "/proj/.claude/skills/a/SKILL.md" })]
    })
    mtimes.set("/proj/.claude/skills/a/SKILL.md", 20)
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])

    // Editing a SKILL.md's frontmatter bumps no directory — only the file.
    mtimes.set("/proj/.claude/skills/a/SKILL.md", 21)
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-2"])
    expect(calls).toBe(2)
  })

  test("rescans when a root directory's mtime changes", () => {
    let calls = 0
    const { svc, mtimes } = makeStampedService(() => {
      calls += 1
      return [raw({ name: `n-${calls}`, kind: "skill", scope: "personal", filePath: "/home/u/.claude/skills/a/SKILL.md" })]
    })
    mtimes.set("/home/u/.claude/skills", 10)
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])

    // A brand-new skill folder bumps its parent root.
    mtimes.set("/home/u/.claude/skills", 11)
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-2"])
    expect(calls).toBe(2)
  })

  test("treats a vanished file as changed", () => {
    let calls = 0
    const { svc, mtimes } = makeStampedService(() => {
      calls += 1
      return [raw({ name: `n-${calls}`, kind: "skill", scope: "project", filePath: "/proj/.claude/skills/a/SKILL.md" })]
    })
    mtimes.set("/proj/.claude/skills/a/SKILL.md", 20)
    svc.list("/proj")

    mtimes.delete("/proj/.claude/skills/a/SKILL.md")
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-2"])
    expect(calls).toBe(2)
  })

  test("rescans after the ttl ceiling even when every stamp is unchanged", () => {
    let calls = 0
    let clock = 1_000
    const { svc, mtimes } = makeStampedService(
      () => {
        calls += 1
        return [raw({ name: `n-${calls}`, kind: "skill", scope: "project", filePath: "/proj/.claude/skills/a/SKILL.md" })]
      },
      { ttl: 1_000, now: () => clock },
    )
    mtimes.set("/proj/.claude/skills/a/SKILL.md", 20)
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])
    expect(calls).toBe(1)

    clock += 2_000
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-2"])
    expect(calls).toBe(2)
  })

  test("never caches when no statMtimes adapter is injected", () => {
    let calls = 0
    const svc = new LocalCatalogService({
      homeDir: "/home/u",
      scan: () => {
        calls += 1
        return []
      },
    })
    svc.list("/proj")
    svc.list("/proj")
    expect(calls).toBe(2)
  })
})

describe("LocalCatalogService", () => {
  test("invalidate clears cache", () => {
    let calls = 0
    const { svc } = makeStampedService(() => {
      calls += 1
      return []
    })
    svc.list("/a")
    svc.list("/a")
    expect(calls).toBe(1)
    svc.invalidate("/a")
    svc.list("/a")
    expect(calls).toBe(2)
  })

  test("scopes cache per cwd", () => {
    let calls = 0
    const { svc } = makeStampedService(({ cwd }) => {
      calls += 1
      return [raw({ name: `n-${cwd.replace(/\W/g, "")}`, kind: "skill", scope: "project" })]
    })
    svc.list("/a")
    svc.list("/b")
    expect(calls).toBe(2)
    expect(svc.list("/a").map((e) => e.name)).toEqual(["n-a"])
    expect(calls).toBe(2)
  })
})
