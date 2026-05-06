import path from "node:path"
import { readdir } from "node:fs/promises"
import { existsSync, statSync, type Dirent } from "node:fs"
import { spawn } from "bun"

export interface ProjectPath {
  path: string
  kind: "file" | "dir"
}

interface CacheEntry {
  files: string[]
  dirs: string[]
  gitIndexMtime: number | null
  builtAt: number
}

const CACHE = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_WALK_ENTRIES = 10_000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const DEFAULT_WALK_EXCLUDES = new Set([
  ".git", "node_modules", ".next", "dist", "build", ".svn", ".hg", ".jj", ".sl",
])

export function clearProjectPathCache(projectId?: string) {
  if (projectId) CACHE.delete(projectId)
  else CACHE.clear()
}

export async function listProjectPaths(args: {
  projectId: string
  localPath: string
  query: string
  limit?: number
}): Promise<ProjectPath[]> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const query = args.query ?? ""

  if (query === "") {
    return listTopLevelEntries(args.localPath, limit)
  }

  const entry = await getOrBuildCache(args.projectId, args.localPath)
  return fuzzyRank(entry, query, limit)
}

async function listTopLevelEntries(localPath: string, limit: number): Promise<ProjectPath[]> {
  try {
    const entries = await readdir(localPath, { withFileTypes: true })
    const result: ProjectPath[] = []
    for (const e of entries) {
      if (DEFAULT_WALK_EXCLUDES.has(e.name)) continue
      if (e.name.startsWith(".")) continue
      result.push(e.isDirectory()
        ? { path: `${e.name}/`, kind: "dir" }
        : { path: e.name, kind: "file" })
    }
    result.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
      return a.path.localeCompare(b.path)
    })
    return result.slice(0, limit)
  } catch {
    return []
  }
}

async function getOrBuildCache(projectId: string, localPath: string): Promise<CacheEntry> {
  const existing = CACHE.get(projectId)
  const gitIndexMtime = getGitIndexMtime(localPath)
  const now = Date.now()

  if (existing) {
    const gitChanged = gitIndexMtime !== null && gitIndexMtime !== existing.gitIndexMtime
    const expired = now - existing.builtAt > CACHE_TTL_MS
    if (!gitChanged && !expired) return existing
  }

  const built = await buildCacheEntry(localPath)
  const next: CacheEntry = { ...built, gitIndexMtime, builtAt: now }
  CACHE.set(projectId, next)
  return next
}

function getGitIndexMtime(localPath: string): number | null {
  const indexPath = path.join(localPath, ".git", "index")
  try {
    return statSync(indexPath).mtimeMs
  } catch {
    return null
  }
}

async function buildCacheEntry(localPath: string): Promise<Pick<CacheEntry, "files" | "dirs">> {
  const gitFiles = await listGitFiles(localPath)
  const files = gitFiles ?? await walkDirectory(localPath)
  const dirs = deriveDirectories(files)
  return { files, dirs }
}

async function listGitFiles(localPath: string): Promise<string[] | null> {
  if (!existsSync(path.join(localPath, ".git"))) return null

  const tracked = await runGit(localPath, ["-c", "core.quotepath=false", "ls-files"])
  if (tracked === null) return null

  const untracked = await runGit(localPath, [
    "-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard",
  ])

  const all = new Set<string>()
  for (const line of tracked) all.add(line)
  for (const line of untracked ?? []) all.add(line)
  return [...all].filter((p) => p.length > 0).map((p) => p.replaceAll("\\", "/"))
}

async function runGit(cwd: string, args: string[]): Promise<string[] | null> {
  try {
    const proc = spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return null
    return stdout.split("\n").filter(Boolean)
  } catch {
    return null
  }
}

async function walkDirectory(root: string): Promise<string[]> {
  const out: string[] = []
  const queue: string[] = [""]
  while (queue.length > 0 && out.length < MAX_WALK_ENTRIES) {
    const rel = queue.shift()!
    const abs = path.join(root, rel)
    let entries: Dirent<string>[]
    try {
      entries = await readdir(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (DEFAULT_WALK_EXCLUDES.has(e.name)) continue
      const nextRel = rel === "" ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        queue.push(nextRel)
      } else if (e.isFile()) {
        out.push(nextRel)
        if (out.length >= MAX_WALK_ENTRIES) break
      }
    }
  }
  return out
}

function deriveDirectories(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const f of files) {
    let idx = f.lastIndexOf("/")
    while (idx > 0) {
      dirs.add(f.slice(0, idx))
      idx = f.lastIndexOf("/", idx - 1)
    }
  }
  return [...dirs]
}

function fuzzyRank(entry: CacheEntry, query: string, limit: number): ProjectPath[] {
  const q = query.toLowerCase()
  const prefix: ProjectPath[] = []
  const substring: ProjectPath[] = []

  for (const f of entry.files) {
    const hay = f.toLowerCase()
    if (hay.startsWith(q)) prefix.push({ path: f, kind: "file" })
    else if (hay.includes(q)) substring.push({ path: f, kind: "file" })
  }
  for (const d of entry.dirs) {
    const hay = d.toLowerCase()
    const withSlash = `${d}/`
    if (hay.startsWith(q)) prefix.push({ path: withSlash, kind: "dir" })
    else if (hay.includes(q)) substring.push({ path: withSlash, kind: "dir" })
  }

  const byPath = (a: ProjectPath, b: ProjectPath) => a.path.localeCompare(b.path)
  prefix.sort(byPath)
  substring.sort(byPath)
  return [...prefix, ...substring].slice(0, limit)
}
