import { expect, test } from "vite-plus/test"
import { memorySkillFiles, type SkillFiles } from "@modelcontextprotocol/server/ext/skills"
import { REMOTE_MCP_SKILLS_RELOAD_MS, createRemoteMcpSkills } from "./remote-mcp-skills"

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}`
}

test("a skill added after the first load appears once the reload interval passes, and listeners are told", async () => {
  let backing = memorySkillFiles({ "refunds/SKILL.md": skillMd("refunds") })
  const files: SkillFiles = { list: (dir) => backing.list(dir), read: (file) => backing.read(file) }
  let now = 1_000
  let listChanges = 0
  const skills = createRemoteMcpSkills({ files, now: () => now, onListChanged: () => { listChanges += 1 } })
  const uris = async () => ((await skills.current())?.entries ?? []).map((entry) => entry.uri)
  expect(await uris()).toEqual(["skill://refunds/SKILL.md"])

  backing = memorySkillFiles({ "refunds/SKILL.md": skillMd("refunds"), "notes/SKILL.md": skillMd("notes") })
  now += REMOTE_MCP_SKILLS_RELOAD_MS - 1
  expect(await uris()).toEqual(["skill://refunds/SKILL.md"])
  expect(listChanges).toBe(0)

  now += 1
  expect(await uris()).toEqual(["skill://notes/SKILL.md", "skill://refunds/SKILL.md"])
  expect(listChanges).toBe(1)
})
