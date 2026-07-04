import { describe, expect, test } from "bun:test"
import type { RawCatalogEntry } from "./local-catalog-io.adapter"
import { LocalCatalogService, mergeWithCli, reduceCatalog } from "./local-catalog"
import type { SlashCommand } from "../shared/types"

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

describe("mergeWithCli", () => {
  test("CLI entries win on case-insensitive collision", () => {
    const cli: SlashCommand[] = [{ name: "model", description: "cli model", argumentHint: "" }]
    const local: SlashCommand[] = [
      { name: "Model", description: "shadow", argumentHint: "", kind: "skill", scope: "personal" },
      { name: "deploy", description: "local", argumentHint: "", kind: "skill", scope: "project" },
    ]
    const merged = mergeWithCli(cli, local)
    expect(merged.map((m) => m.name)).toEqual(["model", "deploy"])
    expect(merged[0]!.kind).toBe("command")
    expect(merged[0]!.scope).toBe("builtin")
  })

  test("local entries pass through when no CLI collision", () => {
    const merged = mergeWithCli(
      [{ name: "help", description: "", argumentHint: "" }],
      [{ name: "c3", description: "c3 skill", argumentHint: "", kind: "skill", scope: "personal" }],
    )
    expect(merged).toHaveLength(2)
  })
})

describe("LocalCatalogService", () => {
  test("caches scan results until ttl expires", () => {
    let calls = 0
    let clock = 1_000
    const svc = new LocalCatalogService({
      scan: () => {
        calls += 1
        return [raw({ name: `n-${calls}`, kind: "skill", scope: "project" })]
      },
      cacheTtlMs: 1_000,
      now: () => clock,
    })
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-1"])
    expect(calls).toBe(1)
    clock += 2_000
    expect(svc.list("/proj").map((e) => e.name)).toEqual(["n-2"])
    expect(calls).toBe(2)
  })

  test("invalidate clears cache", () => {
    let calls = 0
    const svc = new LocalCatalogService({
      scan: () => {
        calls += 1
        return []
      },
    })
    svc.list("/a")
    svc.invalidate("/a")
    svc.list("/a")
    expect(calls).toBe(2)
  })

  test("scopes cache per cwd", () => {
    let calls = 0
    const svc = new LocalCatalogService({
      scan: ({ cwd }) => {
        calls += 1
        return [raw({ name: `n-${cwd.replace(/\W/g, "")}`, kind: "skill", scope: "project" })]
      },
    })
    svc.list("/a")
    svc.list("/b")
    expect(calls).toBe(2)
  })
})
