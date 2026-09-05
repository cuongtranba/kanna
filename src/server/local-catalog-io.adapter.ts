import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { isJsonObject, safeJsonParse, type JsonValue } from "../shared/json"

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

interface ParsedFrontmatter {
  name: string | null
  description: string
  argumentHint: string
  userInvocable: boolean
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

function parseFrontmatter(filePath: string): ParsedFrontmatter {
  const empty: ParsedFrontmatter = { name: null, description: "", argumentHint: "", userInvocable: true }
  const head = readFrontmatterPrefix(filePath)
  if (!head.startsWith("---")) return empty
  const closingIdx = head.indexOf("\n---", 3)
  if (closingIdx < 0) return empty
  const body = head.slice(3, closingIdx).replace(/^\r?\n/, "")
  let name: string | null = null
  let description = ""
  let argumentHint = ""
  let userInvocable = true
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith("#")) continue
    const colon = line.indexOf(":")
    if (colon < 0) continue
    const key = line.slice(0, colon).trim().toLowerCase()
    let value = line.slice(colon + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1)
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1)
    }
    switch (key) {
      case "name":
        name = value || null
        break
      case "description":
        description = value
        break
      case "argument-hint":
      case "argument_hint":
      case "argumenthint":
        argumentHint = value
        break
      case "user-invocable":
      case "user_invocable":
      case "userinvocable":
        userInvocable = !/^(false|no|0)$/i.test(value)
        break
    }
  }
  return { name, description, argumentHint, userInvocable }
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

function buildEntryFromSkill(args: {
  filePath: string
  commandName: string
  scope: CatalogScope
  pluginName: string | null
}): RawCatalogEntry {
  const fm = parseFrontmatter(args.filePath)
  return {
    name: args.commandName,
    displayName: fm.name ?? args.commandName,
    description: fm.description,
    argumentHint: fm.argumentHint,
    userInvocable: fm.userInvocable,
    kind: "skill",
    scope: args.scope,
    pluginName: args.pluginName,
    filePath: args.filePath,
    mtimeMs: safeStatMtime(args.filePath),
  }
}

function buildEntryFromCommand(args: {
  filePath: string
  commandName: string
  scope: CatalogScope
  pluginName: string | null
}): RawCatalogEntry {
  const fm = parseFrontmatter(args.filePath)
  return {
    name: args.commandName,
    displayName: fm.name ?? args.commandName,
    description: fm.description,
    argumentHint: fm.argumentHint,
    userInvocable: fm.userInvocable,
    kind: "command",
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
      buildEntryFromSkill({
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
        buildEntryFromCommand({
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
  const sources = [
    path.join(args.homeDir, ".claude", "settings.json"),
    path.join(args.cwd, ".claude", "settings.json"),
    path.join(args.cwd, ".claude", "settings.local.json"),
  ]
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

function readInstalledPluginPaths(homeDir: string): Map<string, string> {
  const parsed = readJsonFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"))
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
  const fm = parseFrontmatter(skillFile)
  const commandName = `${pluginName}:${fm.name ?? fallbackSegment}`
  return {
    name: commandName,
    displayName: fm.name ?? commandName,
    description: fm.description,
    argumentHint: fm.argumentHint,
    userInvocable: fm.userInvocable,
    kind: "skill",
    scope: "plugin",
    pluginName,
    filePath: skillFile,
    mtimeMs: safeStatMtime(skillFile),
  }
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
  const installPaths = readInstalledPluginPaths(args.homeDir)
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
  const home = args.homeDir ?? homedir()
  const entries: RawCatalogEntry[] = []
  entries.push(
    ...scanSkillsDir({
      baseDir: path.join(args.cwd, ".claude", "skills"),
      scope: "project",
      pluginName: null,
      namespace: null,
    }),
  )
  entries.push(
    ...scanCommandsDir({
      baseDir: path.join(args.cwd, ".claude", "commands"),
      scope: "project",
      pluginName: null,
      namespace: null,
    }),
  )
  entries.push(
    ...scanSkillsDir({
      baseDir: path.join(home, ".claude", "skills"),
      scope: "personal",
      pluginName: null,
      namespace: null,
    }),
  )
  entries.push(
    ...scanCommandsDir({
      baseDir: path.join(home, ".claude", "commands"),
      scope: "personal",
      pluginName: null,
      namespace: null,
    }),
  )
  entries.push(...scanEnabledPlugins({ cwd: args.cwd, homeDir: home }))
  return entries
}
