import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scanLocalCatalog } from "./local-catalog-io.adapter"

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

  test("plugin marketplace skill is namespaced", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    const skillDir = join(home, ".claude", "plugins", "marketplaces", "acme", "skills", "lint")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: lint stuff\n---\n")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("acme:lint")
    expect(got[0]!.scope).toBe("plugin")
    expect(got[0]!.pluginName).toBe("acme")
  })

  test("marketplace manifest maps source dir to real plugin name", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    // okra-style layout: marketplace folder != plugin name, source "./"
    const marketPath = join(home, ".claude", "plugins", "marketplaces", "okra-marketplace")
    const manifestDir = join(marketPath, ".claude-plugin")
    mkdirSync(manifestDir, { recursive: true })
    writeFileSync(
      join(manifestDir, "marketplace.json"),
      JSON.stringify({ name: "okra-marketplace", plugins: [{ name: "okra", source: "./" }] }),
    )
    const skillDir = join(marketPath, "skills", "reverse-tornado-okr")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\ndescription: okr loop\n---\n")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("okra:reverse-tornado-okr")
    expect(got[0]!.pluginName).toBe("okra")
  })

  test("marketplace manifest maps a subdir source to its plugin name", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    const marketPath = join(home, ".claude", "plugins", "marketplaces", "multi")
    const manifestDir = join(marketPath, ".claude-plugin")
    mkdirSync(manifestDir, { recursive: true })
    writeFileSync(
      join(manifestDir, "marketplace.json"),
      JSON.stringify({ name: "multi", plugins: [{ name: "alpha", source: "./alpha" }] }),
    )
    const skillDir = join(marketPath, "alpha", "SKILL.md")
    mkdirSync(join(marketPath, "alpha"), { recursive: true })
    writeFileSync(skillDir, "---\ndescription: a\n---\n")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("alpha:alpha")
    expect(got[0]!.pluginName).toBe("alpha")
  })

  test("plugin top-level commands dir is namespaced", () => {
    const cwd = tmp("lci-")
    const home = tmp("lci-home-")
    const cmdDir = join(home, ".claude", "plugins", "devops", "commands")
    mkdirSync(cmdDir, { recursive: true })
    writeFileSync(join(cmdDir, "audit.md"), "audit content\n")
    const got = scanLocalCatalog({ cwd, homeDir: home })
    expect(got).toHaveLength(1)
    expect(got[0]!.name).toBe("devops:audit")
    expect(got[0]!.kind).toBe("command")
    expect(got[0]!.pluginName).toBe("devops")
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
