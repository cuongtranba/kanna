import path from "node:path"
import { currentHomeDir } from "./home-dir.adapter"

export const NPX = process.platform === "win32" ? "npx.cmd" : "npx"

export function assertSafeSkillSource(source: string) {
  const normalized = source.trim()
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error("Skill source must be an owner/repo pair.")
  }
  return normalized
}

export function assertSafeSkillId(skillId: string) {
  const normalized = skillId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(normalized)) {
    throw new Error("Skill id is invalid.")
  }
  return normalized
}

export function getGlobalSkillLockPath() {
  const xdgStateHome = process.env.XDG_STATE_HOME?.trim()
  if (xdgStateHome) {
    return path.join(xdgStateHome, "skills", ".skill-lock.json")
  }
  return path.join(currentHomeDir(), ".agents", ".skill-lock.json")
}

export function skillsCliEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY ?? "1" }
}
