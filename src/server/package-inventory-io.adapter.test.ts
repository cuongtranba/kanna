import { describe, test, expect } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { readPackageInventory } from "./package-inventory-io.adapter"

const V3_LOCK = {
  version: 3,
  skills: {
    "test-skill": {
      source: "owner/repo",
      sourceType: "github",
      sourceUrl: "https://github.com/owner/repo",
      skillPath: "/fake/.agents/skills/test-skill",
      skillFolderHash: "deadbeef1234",
      installedAt: "2026-01-10T00:00:00.000Z",
      updatedAt: "2026-01-15T00:00:00.000Z",
      pluginName: "test-skill",
    },
  },
}

async function withTempHome<T>(fn: (tempHome: string) => Promise<T>): Promise<T> {
  const tempHome = await mkdtemp(path.join(tmpdir(), "kanna-pkg-test-"))
  const prevHome = process.env.HOME
  const prevXdg = process.env.XDG_STATE_HOME
  process.env.HOME = tempHome
  delete process.env.XDG_STATE_HOME
  try {
    return await fn(tempHome)
  } finally {
    process.env.HOME = prevHome
    if (prevXdg !== undefined) {
      process.env.XDG_STATE_HOME = prevXdg
    } else {
      delete process.env.XDG_STATE_HOME
    }
    await rm(tempHome, { recursive: true, force: true })
  }
}

describe("readPackageInventory", () => {
  test("reads skill packages from lock file", async () => {
    await withTempHome(async (tempHome) => {
      const agentsDir = path.join(tempHome, ".agents")
      const skillsDir = path.join(agentsDir, "skills")
      await mkdir(skillsDir, { recursive: true })

      const lockPath = path.join(agentsDir, ".skill-lock.json")
      await writeFile(lockPath, JSON.stringify(V3_LOCK), "utf8")

      const snapshot = await readPackageInventory()

      const skillPkg = snapshot.packages.find((p) => p.name === "test-skill")
      expect(skillPkg).toBeDefined()
      expect(skillPkg!.kind).toBe("skill")
      expect(skillPkg!.source).toBe("owner/repo")
      expect(skillPkg!.revision).toBe("deadbeef1234")
      expect(snapshot.readAt).toBeGreaterThan(0)
    })
  }, 15_000)

  test("detects agent presence via symlinks", async () => {
    await withTempHome(async (tempHome) => {
      const agentsDir = path.join(tempHome, ".agents")
      const skillsDir = path.join(agentsDir, "skills")
      const realSkillDir = path.join(skillsDir, "linked-skill")
      await mkdir(realSkillDir, { recursive: true })

      const lockPath = path.join(agentsDir, ".skill-lock.json")
      const lock = {
        version: 3,
        skills: {
          "linked-skill": {
            source: "owner/repo",
            skillPath: realSkillDir,
          },
        },
      }
      await writeFile(lockPath, JSON.stringify(lock), "utf8")

      const claudeSkillsDir = path.join(tempHome, ".claude", "skills")
      await mkdir(claudeSkillsDir, { recursive: true })
      await symlink(realSkillDir, path.join(claudeSkillsDir, "linked-skill"))

      const snapshot = await readPackageInventory()
      const pkg = snapshot.packages.find((p) => p.name === "linked-skill")
      expect(pkg).toBeDefined()
      expect(pkg!.agents).toContain("claude-code")
    })
  }, 15_000)

  test("returns empty skill packages when lock file is absent", async () => {
    await withTempHome(async () => {
      const snapshot = await readPackageInventory()
      const skillPkgs = snapshot.packages.filter((p) => p.kind === "skill")
      expect(skillPkgs).toHaveLength(0)
      const skillErrors = snapshot.errors.filter((e) => e.kind === "skill")
      expect(skillErrors).toHaveLength(0)
    })
  }, 15_000)

  test("snapshot includes readAt timestamp", async () => {
    await withTempHome(async () => {
      const before = Date.now()
      const snapshot = await readPackageInventory()
      const after = Date.now()
      expect(snapshot.readAt).toBeGreaterThanOrEqual(before)
      expect(snapshot.readAt).toBeLessThanOrEqual(after)
    })
  }, 15_000)

  test("returns packages from multiple sources independently", async () => {
    await withTempHome(async (tempHome) => {
      const agentsDir = path.join(tempHome, ".agents")
      await mkdir(agentsDir, { recursive: true })
      const lockPath = path.join(agentsDir, ".skill-lock.json")
      await writeFile(lockPath, JSON.stringify(V3_LOCK), "utf8")

      const snapshot = await readPackageInventory()
      expect(snapshot.packages.some((p) => p.kind === "skill")).toBe(true)
      expect(Array.isArray(snapshot.packages)).toBe(true)
      expect(Array.isArray(snapshot.errors)).toBe(true)
    })
  }, 15_000)
})
