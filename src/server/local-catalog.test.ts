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
  test("stamps the scanned roots and the settings files that gate plugins", () => {
    const roots = catalogRootDirs({ cwd: "/proj", homeDir: "/home/u" })
    expect(roots).toEqual([
      "/proj/.claude/skills",
      "/proj/.claude/commands",
      "/proj/.claude/settings.json",
      "/proj/.claude/settings.local.json",
      "/home/u/.claude/skills",
      "/home/u/.claude/commands",
      "/home/u/.claude/settings.json",
      "/home/u/.claude/plugins/installed_plugins.json",
    ])
  })

  test("enabling a plugin invalidates the cache", () => {
    let calls = 0
    const { svc, mtimes } = makeStampedService(() => {
      calls += 1
      return []
    })
    svc.list("/proj")
    svc.list("/proj")
    expect(calls).toBe(1)

    mtimes.set("/home/u/.claude/settings.json", 5)
    svc.list("/proj")
    expect(calls).toBe(2)
  })
})

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

describe("LocalCatalogService.resolve", () => {
  const entries = [
    raw({ name: "deploy", kind: "skill", scope: "personal", filePath: "/home/u/.claude/skills/deploy/SKILL.md" }),
    raw({ name: "deploy", kind: "skill", scope: "project", filePath: "/proj/.claude/skills/deploy/SKILL.md" }),
    raw({ name: "hidden", kind: "skill", scope: "project", userInvocable: false }),
  ]

  test("returns the same winner list() shows, with the file path list() drops", () => {
    const { svc } = makeStampedService(() => entries)
    expect(svc.resolve("/proj", "deploy")).toMatchObject({
      name: "deploy",
      kind: "skill",
      scope: "project",
      filePath: "/proj/.claude/skills/deploy/SKILL.md",
    })
  })

  test("matches case-insensitively, as the catalog dedupes", () => {
    const { svc } = makeStampedService(() => entries)
    expect(svc.resolve("/proj", "DePloY")?.filePath).toBe("/proj/.claude/skills/deploy/SKILL.md")
  })

  test("refuses a name the picker does not offer, so the two cannot disagree", () => {
    const { svc } = makeStampedService(() => entries)
    expect(svc.resolve("/proj", "hidden")).toBeNull()
    expect(svc.resolve("/proj", "nope")).toBeNull()
  })

  test("shares the cache with list() rather than rescanning", () => {
    let calls = 0
    const { svc } = makeStampedService(() => {
      calls += 1
      return entries
    })
    svc.list("/proj")
    svc.resolve("/proj", "deploy")
    expect(calls).toBe(1)
  })
})

describe("LocalCatalogService.skills", () => {
  test("lists skills only — a command template is not model-invocable", () => {
    const { svc } = makeStampedService(() => [
      raw({ name: "review", kind: "command", scope: "project" }),
      raw({ name: "deploy", kind: "skill", scope: "project" }),
    ])
    expect(svc.skills("/proj").map((e) => e.name)).toEqual(["deploy"])
  })

  test("includes a skill the picker hides", () => {
    const { svc } = makeStampedService(() => [
      raw({ name: "internal", kind: "skill", scope: "project", userInvocable: false }),
    ])
    expect(svc.skills("/proj").map((e) => e.name)).toEqual(["internal"])
  })

  test("still resolves precedence, so one name yields one skill", () => {
    const { svc } = makeStampedService(() => [
      raw({ name: "deploy", kind: "skill", scope: "plugin", description: "plugin" }),
      raw({ name: "deploy", kind: "skill", scope: "project", description: "project" }),
    ])
    expect(svc.skills("/proj")).toHaveLength(1)
    expect(svc.skills("/proj")[0]!.description).toBe("project")
  })

  test("carries name, description and path — the three facts the roster states", () => {
    const { svc } = makeStampedService(() => [
      raw({
        name: "deploy",
        kind: "skill",
        scope: "project",
        description: "Ship it.",
        filePath: "/proj/.claude/skills/deploy/SKILL.md",
      }),
    ])
    expect(svc.skills("/proj")).toEqual([
      { name: "deploy", description: "Ship it.", filePath: "/proj/.claude/skills/deploy/SKILL.md" },
    ])
  })
})
