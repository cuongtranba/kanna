import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs"
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
      const skillsDir = path.join(marketPath, "skills")
      if (existsSync(skillsDir)) {
        entries.push(
          ...scanSkillsDir({
            baseDir: skillsDir,
            scope: "plugin",
            pluginName: market,
            namespace: market,
          }),
        )
      }
      const commandsDir = path.join(marketPath, "commands")
      if (existsSync(commandsDir)) {
        entries.push(
          ...scanCommandsDir({
            baseDir: commandsDir,
            scope: "plugin",
            pluginName: market,
            namespace: market,
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
          entries.push(
            buildEntryFromSkill({
              filePath: flatSkill,
              commandName: `${market}:${child}`,
              scope: "plugin",
              pluginName: market,
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
