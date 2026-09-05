import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CATALOG_FILE_MAX_BYTES, readCatalogFileBody, scanLocalCatalog, statMtimes } from "./local-catalog-io.adapter"

const dirs: string[] = []
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function writeSkill(dir: string, name: string, frontmatter: string): string {
  const skillDir = join(dir, ".claude", "skills", name)
  mkdirSync(skillDir, { recursive: true })
  const file = join(skillDir, "SKILL.md")
  writeFileSync(file, `---\n${frontmatter}---\n\nbody\n`)
  return file
}

function writeCommand(dir: string, name: string, content: string): string {
  const cmdDir = join(dir, ".claude", "commands")
  mkdirSync(cmdDir, { recursive: true })
  const file = join(cmdDir, `${name}.md`)
  writeFileSync(file, content)
  return file
}

describe("statMtimes", () => {
  test("returns a positive mtime for a real path and 0 for a missing one", () => {
    const cwd = tmp("lci-")
    const file = writeSkill(cwd, "deploy", "description: Ship it\n")
    const [real, missing] = statMtimes([file, join(cwd, "nope")])
    expect(real).toBeGreaterThan(0)
    expect(missing).toBe(0)
  })

  test("preserves input order", () => {
    const cwd = tmp("lci-")
    const file = writeSkill(cwd, "deploy", "description: Ship it\n")
    expect(statMtimes([join(cwd, "nope"), file, join(cwd, "nope2")])).toEqual([
      0,
      statMtimes([file])[0]!,
      0,
    ])
  })
})

describe("local-catalog-io.adapter", () => {
  test("parses project skill with full frontmatter", () => {
    const cwd = tmp("lci-")
    writeSkill(cwd, "deploy", "description: Ship it\nargument-hint: <env>\n")
    const home = tmp("lci-home-")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    const e = got[0]!
    expect(e.name).toBe("deploy")
    expect(e.kind).toBe("skill")
    expect(e.scope).toBe("project")
    expect(e.description).toBe("Ship it")
    expect(e.argumentHint).toBe("<env>")
    expect(e.userInvocable).toBe(true)
  })

  test("project command without frontmatter falls back to filename stem", () => {
    const cwd = tmp("lci-")
    writeCommand(cwd, "fix-it", "Plain markdown body\n")
    const home = tmp("lci-home-")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("fix-it")
    expect(got[0]!.kind).toBe("command")
    expect(got[0]!.scope).toBe("project")
    expect(got[0]!.description).toBe("")
  })

  test("user-invocable: false is captured", () => {
    const cwd = tmp("lci-")
    writeSkill(cwd, "background", "description: hidden\nuser-invocable: false\n")
    const home = tmp("lci-home-")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.userInvocable).toBe(false)
  })

  test("personal vs project scope and home dir", () => {
    const cwd = tmp("lci-")
    writeSkill(cwd, "proj-only", "description: project\n")
    const home = tmp("lci-home-")
    const personalSkills = join(home, ".claude", "skills", "shared")
    mkdirSync(personalSkills, { recursive: true })
    writeFileSync(join(personalSkills, "SKILL.md"), "---\ndescription: personal\n---\n")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got.map((e) => `${e.scope}:${e.name}`).sort()).toEqual(["personal:shared", "project:proj-only"])
  })

  test("plugin dirs on disk are ignored unless an enabled plugin claims them", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    const skillDir = join(home, ".claude", "plugins", "marketplaces", "acme", "skills", "lint")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: lint stuff\n---\n")
    expect(scanLocalCatalog({ cwd, homeDir: home })).toEqual([])
  })

  test("malformed frontmatter degrades gracefully", () => {
    const cwd = tmp("lci-")
    const skillDir = join(cwd, ".claude", "skills", "broken")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname-but-no-colon\n---\nbody\n")
    const home = tmp("lci-home-")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("broken")
    expect(got[0]!.description).toBe("")
  })

  test("missing dirs yield empty list", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    expect(scanLocalCatalog({ cwd, homeDir: home })).toEqual([])
  })
})


function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

interface PluginFixture {
  key: string
  enabled?: boolean
  skills?: Record<string, string>
  commands?: Record<string, string>
  rootSkill?: string
  declaredSkills?: string[]
}

function writePluginHome(home: string, plugins: PluginFixture[]): void {
  const enabledPlugins: Record<string, boolean> = {}
  const installed: Record<string, unknown[]> = {}
  const byMarketplace = new Map<string, Record<string, unknown>[]>()

  for (const p of plugins) {
    const [name, marketplace] = p.key.split("@") as [string, string]
    const installPath = join(home, ".claude", "plugins", "cache", marketplace, name, "1.0.0")
    enabledPlugins[p.key] = p.enabled ?? true
    installed[p.key] = [{ scope: "user", installPath, version: "1.0.0" }]

    for (const [skill, frontmatter] of Object.entries(p.skills ?? {})) {
      const dir = join(installPath, "skills", skill)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}---\n\nbody\n`)
    }
    for (const [command, body] of Object.entries(p.commands ?? {})) {
      const dir = join(installPath, "commands")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${command}.md`), body)
    }
    if (p.rootSkill !== undefined) {
      mkdirSync(installPath, { recursive: true })
      writeFileSync(join(installPath, "SKILL.md"), `---\n${p.rootSkill}---\n\nbody\n`)
    }

    const entry: Record<string, unknown> = { name, source: "./" }
    if (p.declaredSkills) entry.skills = p.declaredSkills
    const list = byMarketplace.get(marketplace) ?? []
    list.push(entry)
    byMarketplace.set(marketplace, list)
  }

  writeJson(join(home, ".claude", "settings.json"), { enabledPlugins })
  writeJson(join(home, ".claude", "plugins", "installed_plugins.json"), { version: 2, plugins: installed })
  for (const [marketplace, entries] of byMarketplace) {
    writeJson(
      join(home, ".claude", "plugins", "marketplaces", marketplace, ".claude-plugin", "marketplace.json"),
      { name: marketplace, plugins: entries },
    )
  }
}

describe("local-catalog-io.adapter plugin discovery", () => {
  test("scans an enabled plugin's skills, namespaced by plugin name", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [
      { key: "skill-stack@skill-stack-marketplace", skills: { dokploy: "description: deploy\n" } },
    ])
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("skill-stack:dokploy")
    expect(got[0]!.scope).toBe("plugin")
    expect(got[0]!.pluginName).toBe("skill-stack")
    expect(got[0]!.description).toBe("deploy")
  })

  test("a disabled plugin contributes nothing", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [
      { key: "on@m", skills: { alpha: "description: a\n" } },
      { key: "off@m", enabled: false, skills: { beta: "description: b\n" } },
    ])
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name)).toEqual(["on:alpha"])
  })

  test("the marketplace manifest's skills[] restricts what a plugin exposes", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [
      {
        key: "document-skills@anthropic-agent-skills",
        declaredSkills: ["./skills/xlsx", "./skills/pdf"],
        skills: {
          xlsx: "description: sheets\n",
          pdf: "description: pdfs\n",
          "theme-factory": "description: not exposed by this plugin\n",
        },
      },
    ])
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name).sort()).toEqual([
      "document-skills:pdf",
      "document-skills:xlsx",
    ])
  })

  test("falls back to every skills/* dir when the manifest declares no subset", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [
      { key: "p@m", skills: { one: "description: 1\n", two: "description: 2\n" } },
    ])
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name).sort()).toEqual(["p:one", "p:two"])
  })

  test("a plugin skill's frontmatter name replaces only the last segment", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [
      { key: "my-plugin@m", skills: { review: "name: fancy\ndescription: r\n" } },
    ])
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("my-plugin:fancy")
  })

  test("plugin commands keep their literal-colon stem", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [
      { key: "skill-stack@m", commands: { "go:audit": "audit body\n", stack: "stack body\n" } },
    ])
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name).sort()).toEqual([
      "skill-stack:go:audit",
      "skill-stack:stack",
    ])
  })

  test("a plugin-root SKILL.md takes its whole last segment from frontmatter name", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [{ key: "ymir@ymir", rootSkill: "name: ymir\ndescription: y\n" }])
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name)).toEqual(["ymir:ymir"])
  })

  test("a plugin-root SKILL.md without a name falls back to the plugin name", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [{ key: "solo@m", rootSkill: "description: s\n" }])
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name)).toEqual(["solo:solo"])
  })

  test("skills outside an installed plugin root are never scanned", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [{ key: "skill-stack@skill-stack-marketplace", skills: { real: "description: r\n" } }])
    const fixture = join(
      home, ".claude", "plugins", "marketplaces", "skill-stack-marketplace",
      "tests", "fixtures", "mocks", "skills", "mock-skill-alpha",
    )
    mkdirSync(fixture, { recursive: true })
    writeFileSync(join(fixture, "SKILL.md"), "---\ndescription: mock\n---\n")
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name)).toEqual(["skill-stack:real"])
  })

  test("an enabled plugin with no install on disk is skipped, not guessed", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writeJson(join(home, ".claude", "settings.json"), { enabledPlugins: { "ghost@m": true } })
    expect(scanLocalCatalog({ cwd, homeDir: home })).toEqual([])
  })

  test("project settings can enable a plugin for its own cwd", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    writePluginHome(home, [{ key: "proj-only@m", enabled: false, skills: { go: "description: g\n" } }])
    writeJson(join(cwd, ".claude", "settings.json"), { enabledPlugins: { "proj-only@m": true } })
    expect(scanLocalCatalog({ cwd, homeDir: home }).map((e) => e.name)).toEqual(["proj-only:go"])
  })
})

describe("readCatalogFileBody", () => {
  test("returns the file's full text", () => {
    const cwd = tmp("lci-")
    const file = writeCommand(cwd, "review", "---\ndescription: r\n---\nReview $ARGUMENTS.\n")
    expect(readCatalogFileBody(file)).toBe("---\ndescription: r\n---\nReview $ARGUMENTS.\n")
  })

  test("returns null for a missing file rather than throwing into the send path", () => {
    expect(readCatalogFileBody(join(tmp("lci-"), "nope.md"))).toBeNull()
  })

  test("refuses a file past the size cap instead of inlining it into a prompt", () => {
    const cwd = tmp("lci-")
    const file = writeCommand(cwd, "huge", "x".repeat(CATALOG_FILE_MAX_BYTES + 1))
    expect(readCatalogFileBody(file)).toBeNull()
  })

  test("a file exactly at the cap is still readable", () => {
    const cwd = tmp("lci-")
    const file = writeCommand(cwd, "big", "x".repeat(CATALOG_FILE_MAX_BYTES))
    expect(readCatalogFileBody(file)?.length).toBe(CATALOG_FILE_MAX_BYTES)
  })
})
