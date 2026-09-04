import os from "node:os"
import path from "node:path"
import { stat } from "node:fs/promises"
import { readTextFileOrThrow, spawnCommandCapture } from "./ws-router-io.adapter"
import type { InstalledPackage, PackageInventorySnapshot, PackageKind } from "../shared/packages/types"
import { parseSkillLock } from "../shared/packages/parse-skill-lock"
import { parseClaudePluginList, parseClaudePluginsFile } from "../shared/packages/parse-claude-plugins"
import { parseCodexPluginList } from "../shared/packages/parse-codex-plugins"
import { getGlobalSkillLockPath } from "./ws-router-skills"
import { errorMessage } from "../shared/errors"
import { isJsonObject, safeJsonParse, type JsonValue } from "../shared/json"

interface SourceResult {
  packages: InstalledPackage[]
  error: string | null
}

const AGENT_DIRS: ReadonlyArray<{ agent: string; dir: string }> = [
  { agent: "claude-code", dir: ".claude/skills" },
  { agent: "codex", dir: ".codex/skills" },
]

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function buildAgentPresenceMap(skillNames: string[]): Promise<Map<string, string[]>> {
  const home = resolvedHome()
  const presenceMap = new Map<string, string[]>()

  for (const name of skillNames) {
    const agents: string[] = []
    for (const { agent, dir } of AGENT_DIRS) {
      const skillPath = path.join(home, dir, name)
      if (await pathExists(skillPath)) {
        agents.push(agent)
      }
    }
    presenceMap.set(name, agents)
  }

  return presenceMap
}

function resolvedHome(): string {
  // process.env.HOME is mutable (e.g. in tests); os.homedir() uses getpwuid
  // on Linux and ignores HOME changes after process start, so prefer the env var.
  return process.env.HOME ?? os.homedir()
}

async function readSkillPackages(): Promise<SourceResult> {
  const lockPath = getGlobalSkillLockPath()
  let raw: JsonValue
  try {
    const parsed = safeJsonParse(await readTextFileOrThrow(lockPath))
    if (parsed === null) return { packages: [], error: null }
    raw = parsed
  } catch {
    return { packages: [], error: null }
  }

  // Build presence map only for skill names found in the lock file.
  const skillNames = extractSkillNamesFromLock(raw)
  const presenceMap = await buildAgentPresenceMap(skillNames)

  return parseSkillLock(raw, presenceMap)
}

function extractSkillNamesFromLock(raw: JsonValue): string[] {
  if (!isJsonObject(raw)) return []
  const skills = raw.skills
  if (!isJsonObject(skills)) return []
  return Object.keys(skills)
}

async function readClaudePluginPackages(): Promise<SourceResult> {
  const cwd = resolvedHome()
  try {
    const { stdout, exitCode } = await spawnCommandCapture(
      ["claude", "plugin", "list", "--json"],
      cwd,
      process.env,
    )
    if (exitCode === 0) {
      const raw = safeJsonParse(stdout)
      if (raw !== null) return parseClaudePluginList(raw)
    }
  } catch {
    // CLI unavailable — fall through to the file fallback.
  }

  // Fallback: read the installed_plugins.json file.
  const fallbackPath = path.join(resolvedHome(), ".claude", "plugins", "installed_plugins.json")
  try {
    const raw = safeJsonParse(await readTextFileOrThrow(fallbackPath))
    if (raw === null) return { packages: [], error: null }
    return parseClaudePluginsFile(raw)
  } catch {
    return { packages: [], error: null }
  }
}

async function readCodexPluginPackages(): Promise<SourceResult> {
  const cwd = resolvedHome()
  try {
    const { stdout, exitCode } = await spawnCommandCapture(
      ["codex", "plugin", "list", "--json"],
      cwd,
      process.env,
    )
    if (exitCode === 0) {
      const raw = safeJsonParse(stdout)
      if (raw !== null) return parseCodexPluginList(raw)
    }
    return { packages: [], error: null }
  } catch {
    return { packages: [], error: null }
  }
}

export async function readPackageInventory(): Promise<PackageInventorySnapshot> {
  const errors: Array<{ kind: PackageKind; message: string }> = []

  const [skillResult, claudeResult, codexResult] = await Promise.all([
    readSkillPackages().catch((e: Error): SourceResult => {
      errors.push({ kind: "skill", message: errorMessage(e) })
      return { packages: [], error: null }
    }),
    readClaudePluginPackages().catch((e: Error): SourceResult => {
      errors.push({ kind: "claude-plugin", message: errorMessage(e) })
      return { packages: [], error: null }
    }),
    readCodexPluginPackages().catch((e: Error): SourceResult => {
      errors.push({ kind: "codex-plugin", message: errorMessage(e) })
      return { packages: [], error: null }
    }),
  ])

  if (skillResult.error) {
    errors.push({ kind: "skill", message: skillResult.error })
  }
  if (claudeResult.error) {
    errors.push({ kind: "claude-plugin", message: claudeResult.error })
  }
  if (codexResult.error) {
    errors.push({ kind: "codex-plugin", message: codexResult.error })
  }

  return {
    packages: [
      ...skillResult.packages,
      ...claudeResult.packages,
      ...codexResult.packages,
    ],
    errors,
    readAt: Date.now(),
  }
}
