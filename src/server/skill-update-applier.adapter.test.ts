import { describe, test, expect } from "bun:test"
import { buildRepinSkillCommand } from "./skill-update-applier.adapter"

describe("buildRepinSkillCommand", () => {
  test("appends the skill folder and the ref with #", () => {
    expect(buildRepinSkillCommand("cuongtranba/c3-skill", "skills/c3/SKILL.md", "v11.13.4")).toEqual([
      expect.stringContaining("npx"),
      "skills",
      "add",
      "cuongtranba/c3-skill/skills/c3#v11.13.4",
      "--global",
      "--yes",
    ])
  })

  test("omits the folder for a repo-root skill", () => {
    const command = buildRepinSkillCommand("owner/repo", "SKILL.md", "v1.2.3")
    expect(command).toContain("owner/repo#v1.2.3")
  })

  test("omits the folder when the lock records no path", () => {
    const command = buildRepinSkillCommand("owner/repo", null, "v1.2.3")
    expect(command).toContain("owner/repo#v1.2.3")
  })

  test("handles a deeply vendored folder path", () => {
    const command = buildRepinSkillCommand("pbakaus/impeccable", ".agents/skills/impeccable/SKILL.md", "v2.0.0")
    expect(command).toContain("pbakaus/impeccable/.agents/skills/impeccable#v2.0.0")
  })

  test("rejects a source that is not an owner/repo pair", () => {
    expect(() => buildRepinSkillCommand("not-a-pair", null, "v1.0.0")).toThrow(/owner\/repo/)
    expect(() => buildRepinSkillCommand("owner/repo/extra", null, "v1.0.0")).toThrow(/owner\/repo/)
  })

  test("rejects a ref carrying shell or traversal characters", () => {
    expect(() => buildRepinSkillCommand("owner/repo", null, "v1.0.0; rm -rf /")).toThrow(/ref is invalid/)
    expect(() => buildRepinSkillCommand("owner/repo", null, "../../etc/passwd")).toThrow(/ref is invalid/)
    expect(() => buildRepinSkillCommand("owner/repo", null, "")).toThrow(/ref is invalid/)
  })

  test("rejects a traversal in the recorded skill path", () => {
    expect(() => buildRepinSkillCommand("owner/repo", "../../etc/SKILL.md", "v1.0.0")).toThrow(/path is invalid/)
  })

  test("accepts a branch-shaped ref with a slash", () => {
    const command = buildRepinSkillCommand("owner/repo", null, "release/2026-09")
    expect(command).toContain("owner/repo#release/2026-09")
  })
})
