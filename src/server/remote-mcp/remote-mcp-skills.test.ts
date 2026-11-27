import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills"
import { failingClaudeSession } from "../test-helpers/failing-claude-session"
import { startKannaServer } from "../server"

const PASSWORD = "secret"
const SKILL_MD = "---\nname: refunds\ndescription: Issue a refund.\n---\n# Refunds\nRead references/policy.md first."
const POLICY = "Refunds over 100 need approval."
const PERSONAL_MD = "---\nname: notes\ndescription: Take notes.\n---\n# Notes"

let dataDir = ""
let homeDir = ""
let projectDir = ""
let projectId = ""
let server: Awaited<ReturnType<typeof startKannaServer>>
let client: Client
let skills: SkillsClient

async function writeSkill(root: string, name: string, files: Record<string, string>): Promise<void> {
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(root, ".claude", "skills", name, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-skills-data-"))
  homeDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-skills-home-"))
  projectDir = await mkdtemp(path.join(tmpdir(), "kanna-remote-skills-project-"))
  await writeSkill(projectDir, "refunds", { "SKILL.md": SKILL_MD, "references/policy.md": POLICY })
  await writeSkill(homeDir, "notes", { "SKILL.md": PERSONAL_MD })
  server = await startKannaServer({
    dataDir,
    homeDir,
    port: 0,
    strictPort: false,
    password: PASSWORD,
    trustProxy: false,
    discoverProjects: () => [],
    agentOverrides: { startClaudeSession: failingClaudeSession() },
  })
  projectId = (await server.store.openProject(projectDir, "Project")).id
  client = new Client({ name: "remote-skills-test", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${PASSWORD}` } },
    }),
  )
  skills = new SkillsClient(client)
})

afterAll(async () => {
  await client.close()
  await server.stop()
  await rm(dataDir, { recursive: true, force: true })
  await rm(homeDir, { recursive: true, force: true })
  await rm(projectDir, { recursive: true, force: true })
})

describe("remote MCP serves this machine's skills", () => {
  test("a project's skill and a personal skill are listed once each, beside the existing kanna resources", async () => {
    expect(skills.supported).toBe(true)
    expect(skills.directoryRead).toBe(true)

    const listing = await skills.list()
    const names = listing.skills.map((skill) => `${skill.uri} ${skill.frontmatter.name}`).sort()

    expect(names).toEqual([
      "skill://personal/notes/SKILL.md notes",
      `skill://projects/${projectId}/refunds/SKILL.md refunds`,
    ])
    expect((await client.listResources()).resources.map((resource) => resource.uri)).toContain("kanna://projects")
  })

  test("a skill's instructions and supporting file verify against its manifest and its folder lists", async () => {
    const skill = (await skills.list()).skills.find((entry) => entry.frontmatter.name === "refunds")
    if (!skill) throw new Error("refunds skill not listed")

    const main = await skills.read(skill)
    const policy = await skills.read(skill, "references/policy.md")
    const folder = await skills.readDirectory(`skill://projects/${projectId}/refunds`)

    expect(main).toMatchObject({ verified: true, frontmatter: { name: "refunds" } })
    expect(main.body).toContain("Read references/policy.md first.")
    expect(policy).toMatchObject({ verified: true, text: POLICY })
    expect(folder.resources.map((entry) => entry.name).sort()).toEqual(["SKILL.md", "references"])
  })
})
