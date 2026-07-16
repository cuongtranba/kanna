import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  assertSafeSkillId,
  assertSafeSkillSource,
  buildInstallSkillCommand,
  buildUninstallSkillCommand,
  getGlobalSkillLockPath,
  listInstalledSkills,
  parseInstalledSkillsLock,
} from "./ws-router-skills"

describe("ws-router-skills", () => {
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

  describe("parseInstalledSkillsLock", () => {
    test("parses installed global skills from a lock payload", () => {
      const snapshot = parseInstalledSkillsLock({
        version: 1,
        skills: {
          zeta: {
            source: "owner/zeta",
            sourceType: "github",
            sourceUrl: "https://github.com/owner/zeta",
            skillPath: "skills/zeta/SKILL.md",
            installedAt: "2026-05-01T01:00:00.000Z",
            updatedAt: "2026-05-01T02:00:00.000Z",
            pluginName: "zeta-plugin",
          },
          alpha: {
            source: "owner/alpha",
            sourceType: "github",
          },
          ignored: "not an object",
        },
      }, "/tmp/.skill-lock.json")

      expect(snapshot.lockFilePath).toBe("/tmp/.skill-lock.json")
      // Skills are sorted alphabetically
      expect(snapshot.skills.map((s) => s.name)).toEqual(["alpha", "zeta"])
      expect(snapshot.skills[0]).toMatchObject({
        name: "alpha",
        source: "owner/alpha",
        sourceType: "github",
        sourceUrl: "",
        installedAt: "",
        updatedAt: "",
      })
      expect(snapshot.skills[1]).toMatchObject({
        name: "zeta",
        source: "owner/zeta",
        skillPath: "skills/zeta/SKILL.md",
        pluginName: "zeta-plugin",
      })
    })

    test("returns empty skills list for invalid/null input", () => {
      expect(parseInstalledSkillsLock(null, "/path").skills).toEqual([])
      expect(parseInstalledSkillsLock("string", "/path").skills).toEqual([])
      expect(parseInstalledSkillsLock({}, "/path").skills).toEqual([])
      expect(parseInstalledSkillsLock({ skills: [] }, "/path").skills).toEqual([])
    })
  })

  describe("listInstalledSkills", () => {
    test("returns empty snapshot when lock file is missing", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kanna-skills-"))
      try {
        const missingPath = path.join(dir, "missing.json")
        const result = await listInstalledSkills(missingPath)
        expect(result).toEqual({ lockFilePath: missingPath, skills: [] })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })

    test("returns empty snapshot when lock file is invalid JSON", async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "kanna-skills-"))
      try {
        const invalidPath = path.join(dir, ".skill-lock.json")
        await writeFile(invalidPath, "{", "utf8")
        const result = await listInstalledSkills(invalidPath)
        expect(result).toEqual({ lockFilePath: invalidPath, skills: [] })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe("buildInstallSkillCommand", () => {
    test("builds global install command for universal and claude-code aliases", () => {
      const cmd = buildInstallSkillCommand("owner/repo", "my-skill")
      // First element is the binary (platform-dependent), skip it
      expect(cmd.slice(1)).toEqual([
        "skills",
        "add",
        "owner/repo",
        "--skill",
        "my-skill",
        "--global",
        "--agent",
        "universal",
        "claude-code",
        "--yes",
      ])
    })

    test("throws on invalid source or skillId", () => {
      expect(() => buildInstallSkillCommand("https://github.com/o/r", "skill")).toThrow()
      expect(() => buildInstallSkillCommand("owner/repo", "../bad")).toThrow()
    })
  })

  describe("buildUninstallSkillCommand", () => {
    test("builds global uninstall command for universal and claude-code aliases", () => {
      const cmd = buildUninstallSkillCommand("my-skill")
      expect(cmd.slice(1)).toEqual([
        "skills",
        "remove",
        "my-skill",
        "--global",
        "--agent",
        "universal",
        "claude-code",
        "--yes",
      ])
    })

    test("throws on invalid skillId", () => {
      expect(() => buildUninstallSkillCommand("../bad")).toThrow()
    })
  })
})
