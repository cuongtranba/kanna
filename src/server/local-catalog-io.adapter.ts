import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

export type CatalogKind = "skill" | "command"
export type CatalogScope = "project" | "personal" | "plugin"

export interface RawCatalogEntry {
  /** The literal `/name` users type, without the leading slash. */
  name: string
  /** Display label from frontmatter `name`, else falls back to `name`. */
  displayName: string
  description: string
  argumentHint: string
  userInvocable: boolean
  kind: CatalogKind
  scope: CatalogScope
  pluginName: string | null
  filePath: string
  /** File mtime in ms; used by the cache layer. */
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

function safeStatMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return 0
  }
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

function scanPluginDir(pluginDir: string, pluginName: string): RawCatalogEntry[] {
  const entries: RawCatalogEntry[] = []
  entries.push(
    ...scanSkillsDir({
      baseDir: path.join(pluginDir, "skills"),
      scope: "plugin",
      pluginName,
      namespace: pluginName,
    }),
  )
  entries.push(
    ...scanCommandsDir({
      baseDir: path.join(pluginDir, "commands"),
      scope: "plugin",
      pluginName,
      namespace: pluginName,
    }),
  )
  const rootSkill = path.join(pluginDir, "SKILL.md")
  if (existsSync(rootSkill)) {
    const fm = parseFrontmatter(rootSkill)
    const base = fm.name ?? pluginName
    const commandName = `${pluginName}:${base}`
    entries.push({
      name: commandName,
      displayName: fm.name ?? commandName,
      description: fm.description,
      argumentHint: fm.argumentHint,
      userInvocable: fm.userInvocable,
      kind: "skill",
      scope: "plugin",
      pluginName,
      filePath: rootSkill,
      mtimeMs: safeStatMtime(rootSkill),
    })
  }
  return entries
}

interface MarketplacePlugin {
  name: string
  /** Absolute resolved directory the plugin's files live under. */
  sourceDir: string
}

/**
 * Read a marketplace's `.claude-plugin/marketplace.json` and map each declared
 * plugin's local `source` directory to its real plugin name. Claude namespaces
 * a plugin's slash commands by the plugin name, NOT the marketplace folder
 * name, so this mapping is what lets the picker emit a command the CLI accepts.
 * Non-string sources (git/github) have no local dir and are skipped.
 */
function readMarketplacePlugins(marketPath: string): MarketplacePlugin[] {
  const manifestPath = path.join(marketPath, ".claude-plugin", "marketplace.json")
  if (!existsSync(manifestPath)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch {
    return []
  }
  if (typeof parsed !== "object" || parsed === null) return []
  const plugins = (parsed as { plugins?: unknown }).plugins
  if (!Array.isArray(plugins)) return []
  const out: MarketplacePlugin[] = []
  for (const raw of plugins) {
    if (typeof raw !== "object" || raw === null) continue
    const name = (raw as { name?: unknown }).name
    const source = (raw as { source?: unknown }).source
    if (typeof name !== "string" || name.length === 0) continue
    if (typeof source !== "string") continue
    out.push({ name, sourceDir: path.resolve(marketPath, source) })
  }
  return out
}

/**
 * Find the declared plugin whose source directory is the nearest ancestor of
 * `dir` (the most specific match wins). Returns its name, else the marketplace
 * folder name as the fallback namespace for un-manifested marketplaces.
 */
function resolvePluginNamespace(plugins: readonly MarketplacePlugin[], dir: string, fallback: string): string {
  let best: MarketplacePlugin | null = null
  for (const plugin of plugins) {
    const isOwned = dir === plugin.sourceDir || dir.startsWith(plugin.sourceDir + path.sep)
    if (!isOwned) continue
    if (!best || plugin.sourceDir.length > best.sourceDir.length) best = plugin
  }
  return best?.name ?? fallback
}

function scanPluginsRoot(pluginsRoot: string): RawCatalogEntry[] {
  if (!existsSync(pluginsRoot)) return []
  const entries: RawCatalogEntry[] = []
  for (const child of safeReaddir(pluginsRoot)) {
    if (child === "marketplaces") continue
    const childPath = path.join(pluginsRoot, child)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(childPath)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    entries.push(...scanPluginDir(childPath, child))
  }
  const marketplaces = path.join(pluginsRoot, "marketplaces")
  if (existsSync(marketplaces)) {
    for (const market of safeReaddir(marketplaces)) {
      const marketPath = path.join(marketplaces, market)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(marketPath)
      } catch {
        continue
      }
      if (!st.isDirectory()) continue
      const plugins = readMarketplacePlugins(marketPath)
      const skillsDir = path.join(marketPath, "skills")
      if (existsSync(skillsDir)) {
        const ns = resolvePluginNamespace(plugins, skillsDir, market)
        entries.push(
          ...scanSkillsDir({
            baseDir: skillsDir,
            scope: "plugin",
            pluginName: ns,
            namespace: ns,
          }),
        )
      }
      const commandsDir = path.join(marketPath, "commands")
      if (existsSync(commandsDir)) {
        const ns = resolvePluginNamespace(plugins, commandsDir, market)
        entries.push(
          ...scanCommandsDir({
            baseDir: commandsDir,
            scope: "plugin",
            pluginName: ns,
            namespace: ns,
          }),
        )
      }
      for (const child of safeReaddir(marketPath)) {
        if (child === "skills" || child === "commands") continue
        const childPath = path.join(marketPath, child)
        let cst: ReturnType<typeof statSync>
        try {
          cst = statSync(childPath)
        } catch {
          continue
        }
        if (!cst.isDirectory()) continue
        const flatSkill = path.join(childPath, "SKILL.md")
        if (existsSync(flatSkill)) {
          const ns = resolvePluginNamespace(plugins, childPath, market)
          entries.push(
            buildEntryFromSkill({
              filePath: flatSkill,
              commandName: `${ns}:${child}`,
              scope: "plugin",
              pluginName: ns,
            }),
          )
        }
      }
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
  entries.push(...scanPluginsRoot(path.join(home, ".claude", "plugins")))
  return entries
}
