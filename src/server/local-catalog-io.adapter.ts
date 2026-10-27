import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { isJsonObject, safeJsonParse, type JsonValue } from "../shared/json"
import { catalogLocations, parseFrontmatter } from "./local-catalog"

export type CatalogKind = "skill" | "command"
export type CatalogScope = "project" | "personal" | "plugin"

export interface RawCatalogEntry {
  name: string
  displayName: string
  description: string
  argumentHint: string
  userInvocable: boolean
  kind: CatalogKind
  scope: CatalogScope
  pluginName: string | null
  filePath: string
  mtimeMs: number
}

export interface ScanLocalCatalogArgs {
  cwd: string
  homeDir?: string
}

const FRONTMATTER_BUDGET_BYTES = 8 * 1024

function readFrontmatterPrefix(filePath: string): string {
  try {
    const buf = Buffer.alloc(FRONTMATTER_BUDGET_BYTES)
    const fd = openSync(filePath, "r")
    try {
      const n = readSync(fd, buf, 0, FRONTMATTER_BUDGET_BYTES, 0)
      return buf.subarray(0, n).toString("utf8")
    } finally {
      closeSync(fd)
    }
  } catch {
    return ""
  }
}

export const CATALOG_FILE_MAX_BYTES = 256 * 1024

export function readCatalogFileBody(filePath: string): string | null {
  try {
    if (statSync(filePath).size > CATALOG_FILE_MAX_BYTES) return null
    return readFileSync(filePath, "utf8")
  } catch {
    return null
  }
}

function safeStatMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
}

export function defaultHomeDir(): string {
  return homedir()
}

export function statMtimes(paths: readonly string[]): number[] {
  return paths.map(safeStatMtime)
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function buildEntry(args: {
  kind: CatalogKind
  filePath: string
  commandName: string | ((frontmatterName: string | null) => string)
  scope: CatalogScope
  pluginName: string | null
}): RawCatalogEntry {
  const fm = parseFrontmatter(readFrontmatterPrefix(args.filePath))
  const commandName = typeof args.commandName === "function" ? args.commandName(fm.name) : args.commandName
  return {
    name: commandName,
    displayName: fm.name ?? commandName,
    description: fm.description,
    argumentHint: fm.argumentHint,
    userInvocable: fm.userInvocable,
    kind: args.kind,
    scope: args.scope,
    pluginName: args.pluginName,
    filePath: args.filePath,
    mtimeMs: safeStatMtime(args.filePath),
  }
}

function scanSkillsDir(args: {
  baseDir: string
  scope: CatalogScope
  pluginName: string | null
  namespace: string | null
}): RawCatalogEntry[] {
  const entries: RawCatalogEntry[] = []
  if (!existsSync(args.baseDir)) return entries
  for (const child of safeReaddir(args.baseDir)) {
    const childPath = path.join(args.baseDir, child)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(childPath)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const skillFile = path.join(childPath, "SKILL.md")
    if (!existsSync(skillFile)) continue
    const baseName = child
    const commandName = args.namespace ? `${args.namespace}:${baseName}` : baseName
    entries.push(
      buildEntry({
        kind: "skill",
        filePath: skillFile,
        commandName,
        scope: args.scope,
        pluginName: args.pluginName,
      }),
    )
  }
  return entries
}

function scanCommandsDir(args: {
  baseDir: string
  scope: CatalogScope
  pluginName: string | null
  namespace: string | null
}): RawCatalogEntry[] {
  const entries: RawCatalogEntry[] = []
  if (!existsSync(args.baseDir)) return entries
  const stack: string[] = [args.baseDir]
  while (stack.length > 0) {
    const dir = stack.pop()!
    for (const child of safeReaddir(dir)) {
      const childPath = path.join(dir, child)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(childPath)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(childPath)
        continue
      }
      if (!child.endsWith(".md")) continue
      const relPath = path.relative(args.baseDir, childPath)
      const stem = relPath.slice(0, -3).split(path.sep).join("/")
      const commandName = args.namespace ? `${args.namespace}:${path.basename(stem)}` : stem
      entries.push(
        buildEntry({
          kind: "command",
          filePath: childPath,
          commandName,
          scope: args.scope,
          pluginName: args.pluginName,
        }),
      )
    }
  }
  return entries
}


function readJsonFile(filePath: string): JsonValue | null {
  if (!existsSync(filePath)) return null
  try {
    return safeJsonParse(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function readEnabledPluginKeys(args: { cwd: string; homeDir: string }): Set<string> {
  const enabled = new Set<string>()
  const locations = catalogLocations(args)
  const sources = [locations.personalSettings, locations.projectSettings, locations.projectLocalSettings]
  for (const source of sources) {
    const parsed = readJsonFile(source)
    if (parsed === null || !isJsonObject(parsed) || !isJsonObject(parsed.enabledPlugins)) continue
    for (const [key, value] of Object.entries(parsed.enabledPlugins)) {
      if (value === true) enabled.add(key)
      else if (value === false) enabled.delete(key)
    }
  }
  return enabled
}

function readInstalledPluginPaths(args: { cwd: string; homeDir: string }): Map<string, string> {
  const parsed = readJsonFile(catalogLocations(args).installedPlugins)
  const out = new Map<string, string>()
  if (parsed === null || !isJsonObject(parsed) || !isJsonObject(parsed.plugins)) return out
  for (const [key, installs] of Object.entries(parsed.plugins)) {
    if (!Array.isArray(installs)) continue
    let fallback: string | null = null
    let preferred: string | null = null
    for (const install of installs) {
      if (!isJsonObject(install)) continue
      const installPath = install.installPath
      if (typeof installPath !== "string" || installPath.length === 0) continue
      fallback ??= installPath
      if (install.scope === "user") preferred ??= installPath
    }
    const resolved = preferred ?? fallback
    if (resolved) out.set(key, resolved)
  }
  return out
}

function readDeclaredSkillDirs(args: {
  homeDir: string
  marketplace: string
  pluginName: string
  installPath: string
}): string[] | null {
  const parsed = readJsonFile(
    path.join(args.homeDir, ".claude", "plugins", "marketplaces", args.marketplace, ".claude-plugin", "marketplace.json"),
  )
  if (parsed === null || !isJsonObject(parsed) || !Array.isArray(parsed.plugins)) return null
  for (const raw of parsed.plugins) {
    if (!isJsonObject(raw) || raw.name !== args.pluginName) continue
    const declared: JsonValue = raw.skills
    if (!Array.isArray(declared)) return null
    return declared
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .map((entry) => path.resolve(args.installPath, entry))
  }
  return null
}

function buildPluginSkillEntry(skillFile: string, pluginName: string, fallbackSegment: string): RawCatalogEntry {
  return buildEntry({
    kind: "skill",
    filePath: skillFile,
    commandName: (frontmatterName) => `${pluginName}:${frontmatterName ?? fallbackSegment}`,
    scope: "plugin",
    pluginName,
  })
}

function scanPluginSkillDirs(skillDirs: readonly string[], pluginName: string): RawCatalogEntry[] {
  const entries: RawCatalogEntry[] = []
  for (const dir of skillDirs) {
    const skillFile = path.join(dir, "SKILL.md")
    if (!existsSync(skillFile)) continue
    entries.push(buildPluginSkillEntry(skillFile, pluginName, path.basename(dir)))
  }
  return entries
}

function childDirectories(baseDir: string): string[] {
  if (!existsSync(baseDir)) return []
  const out: string[] = []
  for (const child of safeReaddir(baseDir)) {
    const childPath = path.join(baseDir, child)
    try {
      if (statSync(childPath).isDirectory()) out.push(childPath)
    } catch {
      continue
    }
  }
  return out
}

function scanEnabledPlugins(args: { cwd: string; homeDir: string }): RawCatalogEntry[] {
  const enabled = readEnabledPluginKeys(args)
  if (enabled.size === 0) return []
  const installPaths = readInstalledPluginPaths(args)
  const entries: RawCatalogEntry[] = []

  for (const key of enabled) {
    const separator = key.lastIndexOf("@")
    if (separator <= 0) continue
    const pluginName = key.slice(0, separator)
    const marketplace = key.slice(separator + 1)
    const installPath = installPaths.get(key)
    if (!installPath || !existsSync(installPath)) continue

    const declared = readDeclaredSkillDirs({ homeDir: args.homeDir, marketplace, pluginName, installPath })
    entries.push(
      ...scanPluginSkillDirs(declared ?? childDirectories(path.join(installPath, "skills")), pluginName),
    )
    entries.push(
      ...scanCommandsDir({
        baseDir: path.join(installPath, "commands"),
        scope: "plugin",
        pluginName,
        namespace: pluginName,
      }),
    )
    const rootSkill = path.join(installPath, "SKILL.md")
    if (existsSync(rootSkill)) {
      entries.push(buildPluginSkillEntry(rootSkill, pluginName, pluginName))
    }
  }
  return entries
}

export function scanLocalCatalog(args: ScanLocalCatalogArgs): RawCatalogEntry[] {
  const homeDir = args.homeDir ?? homedir()
  const locations = catalogLocations({ cwd: args.cwd, homeDir })
  return [
    ...scanSkillsDir({ baseDir: locations.projectSkills, scope: "project", pluginName: null, namespace: null }),
    ...scanCommandsDir({ baseDir: locations.projectCommands, scope: "project", pluginName: null, namespace: null }),
    ...scanSkillsDir({ baseDir: locations.personalSkills, scope: "personal", pluginName: null, namespace: null }),
    ...scanCommandsDir({ baseDir: locations.personalCommands, scope: "personal", pluginName: null, namespace: null }),
    ...scanEnabledPlugins({ cwd: args.cwd, homeDir }),
  ]
}
