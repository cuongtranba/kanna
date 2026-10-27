import { describe, expect, test } from "bun:test"
import { assertSafeSkillId, assertSafeSkillSource, getGlobalSkillLockPath } from "./skills-cli"

describe("skills-cli", () => {
  describe("assertSafeSkillSource", () => {
    test("trims and accepts valid owner/repo pairs", () => {
      expect(assertSafeSkillSource("owner/repo")).toBe("owner/repo")
      expect(assertSafeSkillSource(" owner/repo ")).toBe("owner/repo")
      expect(assertSafeSkillSource("Org-Name/my.skill_1")).toBe("Org-Name/my.skill_1")
    })

    test("rejects invalid sources", () => {
      expect(() => assertSafeSkillSource("https://github.com/owner/repo")).toThrow("owner/repo")
      expect(() => assertSafeSkillSource("just-a-name")).toThrow("owner/repo")
      expect(() => assertSafeSkillSource("")).toThrow()
      expect(() => assertSafeSkillSource("owner/repo/extra")).toThrow()
    })
  })

  describe("assertSafeSkillId", () => {
    test("trims and accepts valid skill ids", () => {
      expect(assertSafeSkillId("my-skill")).toBe("my-skill")
      expect(assertSafeSkillId(" my-skill_1 ")).toBe("my-skill_1")
      expect(assertSafeSkillId("A")).toBe("A")
    })

    test("rejects invalid skill ids", () => {
      expect(() => assertSafeSkillId("../nope")).toThrow("Skill id is invalid.")
      expect(() => assertSafeSkillId("")).toThrow()
      expect(() => assertSafeSkillId("-bad-start")).toThrow()
    })
  })

  describe("getGlobalSkillLockPath", () => {
    test("returns XDG_STATE_HOME path when env var is set", () => {
      const orig = process.env.XDG_STATE_HOME
      try {
        process.env.XDG_STATE_HOME = "/custom/state"
        const lockPath = getGlobalSkillLockPath()
        expect(lockPath).toContain("/custom/state")
        expect(lockPath).toContain(".skill-lock.json")
      } finally {
        if (orig === undefined) {
          delete process.env.XDG_STATE_HOME
        } else {
          process.env.XDG_STATE_HOME = orig
        }
      }
    })

    test("falls back to ~/.agents/.skill-lock.json", () => {
      const orig = process.env.XDG_STATE_HOME
      try {
        delete process.env.XDG_STATE_HOME
        const lockPath = getGlobalSkillLockPath()
        expect(lockPath).toContain(".agents")
        expect(lockPath).toContain(".skill-lock.json")
      } finally {
        if (orig !== undefined) {
          process.env.XDG_STATE_HOME = orig
        }
      }
    })
  })
})
