import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { AgentProvider } from "../shared/types"
import { isJsonObject, safeJsonParse, type JsonObject } from "../shared/json"
import { resolveLocalPath } from "./paths"

export interface DiscoveredProject {
  localPath: string
  title: string
  modifiedAt: number
  discoveredByProviders: AgentProvider[]
}

export interface ProviderDiscoveredProject {
  provider: AgentProvider
  localPath: string
  title: string
  modifiedAt: number
}

export interface ProjectDiscoveryAdapter {
  provider: AgentProvider
  scan(homeDir?: string): ProviderDiscoveredProject[]
}

function resolveEncodedClaudePath(folderName: string) {
  const segments = folderName.replace(/^-/, "").split("-").filter(Boolean)
  let currentPath = ""
  let remainingSegments = [...segments]

  while (remainingSegments.length > 0) {
    let found = false

    for (let index = remainingSegments.length; index >= 1; index -= 1) {
      const segment = remainingSegments.slice(0, index).join("-")
      const candidate = `${currentPath}/${segment}`

      if (existsSync(candidate)) {
        currentPath = candidate
        remainingSegments = remainingSegments.slice(index)
        found = true
        break
      }
    }

    if (!found) {
      const [head, ...tail] = remainingSegments
      currentPath = `${currentPath}/${head}`
      remainingSegments = tail
    }
  }

  return currentPath || "/"
}

function normalizeExistingDirectory(localPath: string) {
  try {
    const normalized = resolveLocalPath(localPath)
    if (!statSync(normalized).isDirectory()) {
      return null
    }
    return normalized
  } catch {
    return null
  }
}

function mergeDiscoveredProjects(projects: Iterable<ProviderDiscoveredProject>): DiscoveredProject[] {
  const merged = new Map<string, DiscoveredProject>()

  for (const project of projects) {
    const existing = merged.get(project.localPath)
    if (!existing) {
      merged.set(project.localPath, {
        localPath: project.localPath,
        title: project.title || path.basename(project.localPath) || project.localPath,
        modifiedAt: project.modifiedAt,
        discoveredByProviders: [project.provider],
      })
      continue
    }

    if (project.modifiedAt > existing.modifiedAt) {
      existing.modifiedAt = project.modifiedAt
      existing.title = project.title || path.basename(project.localPath) || project.localPath
    }
    if (!existing.discoveredByProviders.includes(project.provider)) {
      existing.discoveredByProviders.push(project.provider)
    }
  }

  return [...merged.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export class ClaudeProjectDiscoveryAdapter implements ProjectDiscoveryAdapter {
  readonly provider = "claude" as const

  scan(homeDir: string = homedir()): ProviderDiscoveredProject[] {
    const projectsDir = path.join(homeDir, ".claude", "projects")
    if (!existsSync(projectsDir)) {
      return []
    }

    const entries = readdirSync(projectsDir, { withFileTypes: true })
    const projects: ProviderDiscoveredProject[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const resolvedPath = resolveEncodedClaudePath(entry.name)
      const normalizedPath = normalizeExistingDirectory(resolvedPath)
      if (!normalizedPath) {
        continue
      }

      const stat = statSync(path.join(projectsDir, entry.name))
      projects.push({
        provider: this.provider,
        localPath: normalizedPath,
        title: path.basename(normalizedPath) || normalizedPath,
        modifiedAt: stat.mtimeMs,
      })
    }

    return mergeDiscoveredProjects(projects).map((project): ProviderDiscoveredProject => ({
      provider: this.provider,
      localPath: project.localPath,
      title: project.title,
      modifiedAt: project.modifiedAt,
    }))
  }
}

function parseJsonRecord(line: string): JsonObject | null {
  const parsed = safeJsonParse(line)
  return parsed !== null && isJsonObject(parsed) ? parsed : null
}

function readCodexSessionIndex(indexPath: string) {
  const updatedAtById = new Map<string, number>()
  if (!existsSync(indexPath)) {
    return updatedAtById
  }

  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    if (!line.trim()) continue
    const record = parseJsonRecord(line)
    if (!record) continue

    const id = typeof record.id === "string" ? record.id : null
    const updatedAt = typeof record.updated_at === "string" ? Date.parse(record.updated_at) : Number.NaN
    if (!id || Number.isNaN(updatedAt)) continue

    const existing = updatedAtById.get(id)
    if (existing === undefined || updatedAt > existing) {
      updatedAtById.set(id, updatedAt)
    }
  }

  return updatedAtById
}

function collectCodexSessionFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return []
  }

  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectCodexSessionFiles(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath)
    }
  }
  return files
}

function readCodexConfiguredProjects(configPath: string) {
  const projects = new Map<string, number>()
  if (!existsSync(configPath)) {
    return projects
  }

  const configMtime = statSync(configPath).mtimeMs
  for (const line of readFileSync(configPath, "utf8").split("\n")) {
    const match = line.match(/^\[projects\."(.+)"\]$/)
    if (!match?.[1]) continue
    projects.set(match[1], configMtime)
  }

  return projects
}

const FIRST_LINE_CHUNK_BYTES = 64 * 1024

// Rollout files grow to tens of MB and there can be thousands of them; discovery
// runs on the event loop on every `local-projects` subscribe, so read only up to
// the first newline instead of the whole file.
function readFirstLine(filePath: string): string {
  const fd = openSync(filePath, "r")
  try {
    const chunks: Buffer[] = []
    let position = 0
    while (true) {
      const chunk = Buffer.alloc(FIRST_LINE_CHUNK_BYTES)
      const bytesRead = readSync(fd, chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      const newlineIndex = chunk.subarray(0, bytesRead).indexOf(10)
      if (newlineIndex !== -1) {
        chunks.push(chunk.subarray(0, newlineIndex))
        break
      }
      chunks.push(chunk.subarray(0, bytesRead))
      position += bytesRead
    }
    return Buffer.concat(chunks).toString("utf8")
  } finally {
    closeSync(fd)
  }
}

type CodexSessionMetadata = { sessionId: string; cwd: string; modifiedAt: number }

// Keyed by file path; reused while mtime and size are unchanged.
const codexSessionMetadataCache = new Map<string, { mtimeMs: number; size: number; metadata: CodexSessionMetadata | null }>()

function parseCodexSessionMetadata(sessionFile: string, mtimeMs: number): CodexSessionMetadata | null {
  const firstLine = readFirstLine(sessionFile)
  if (!firstLine?.trim()) return null

  const record = parseJsonRecord(firstLine)
  if (!record || record.type !== "session_meta") return null

  const payload = record.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null

  const payloadRecord: JsonObject = isJsonObject(payload) ? payload : {}
  const sessionId = typeof payloadRecord.id === "string" ? payloadRecord.id : null
  const cwd = typeof payloadRecord.cwd === "string" ? payloadRecord.cwd : null
  if (!sessionId || !cwd) return null

  const recordTimestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN
  const payloadTimestamp = typeof payloadRecord.timestamp === "string" ? Date.parse(payloadRecord.timestamp) : Number.NaN
  const modifiedAt = [recordTimestamp, payloadTimestamp, mtimeMs].find((value) => !Number.isNaN(value)) ?? mtimeMs

  return { sessionId, cwd, modifiedAt }
}

function readCodexSessionMetadata(sessionsDir: string) {
  const metadataById = new Map<string, { cwd: string; modifiedAt: number }>()
  const seenFiles = new Set<string>()

  for (const sessionFile of collectCodexSessionFiles(sessionsDir)) {
    seenFiles.add(sessionFile)
    const fileStat = statSync(sessionFile)
    const cached = codexSessionMetadataCache.get(sessionFile)
    let metadata: CodexSessionMetadata | null
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      metadata = cached.metadata
    } else {
      metadata = parseCodexSessionMetadata(sessionFile, fileStat.mtimeMs)
      codexSessionMetadataCache.set(sessionFile, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, metadata })
    }
    if (!metadata) continue

    metadataById.set(metadata.sessionId, { cwd: metadata.cwd, modifiedAt: metadata.modifiedAt })
  }

  for (const cachedFile of codexSessionMetadataCache.keys()) {
    if (!seenFiles.has(cachedFile)) codexSessionMetadataCache.delete(cachedFile)
  }

  return metadataById
}

export class CodexProjectDiscoveryAdapter implements ProjectDiscoveryAdapter {
  readonly provider = "codex" as const

  scan(homeDir: string = homedir()): ProviderDiscoveredProject[] {
    const indexPath = path.join(homeDir, ".codex", "session_index.jsonl")
    const sessionsDir = path.join(homeDir, ".codex", "sessions")
    const configPath = path.join(homeDir, ".codex", "config.toml")
    const updatedAtById = readCodexSessionIndex(indexPath)
    const metadataById = readCodexSessionMetadata(sessionsDir)
    const configuredProjects = readCodexConfiguredProjects(configPath)
    const projects: ProviderDiscoveredProject[] = []

    for (const [sessionId, metadata] of metadataById.entries()) {
      const modifiedAt = updatedAtById.get(sessionId) ?? metadata.modifiedAt
      const cwd = metadata.cwd
      if (!cwd) {
        continue
      }
      if (!path.isAbsolute(cwd)) {
        continue
      }

      const normalizedPath = normalizeExistingDirectory(cwd)
      if (!normalizedPath) {
        continue
      }

      projects.push({
        provider: this.provider,
        localPath: normalizedPath,
        title: path.basename(normalizedPath) || normalizedPath,
        modifiedAt,
      })
    }

    for (const [configuredPath, modifiedAt] of configuredProjects.entries()) {
      if (!path.isAbsolute(configuredPath)) {
        continue
      }

      const normalizedPath = normalizeExistingDirectory(configuredPath)
      if (!normalizedPath) {
        continue
      }

      projects.push({
        provider: this.provider,
        localPath: normalizedPath,
        title: path.basename(normalizedPath) || normalizedPath,
        modifiedAt,
      })
    }

    return mergeDiscoveredProjects(projects).map((project): ProviderDiscoveredProject => ({
      provider: this.provider,
      localPath: project.localPath,
      title: project.title,
      modifiedAt: project.modifiedAt,
    }))
  }
}

export const DEFAULT_PROJECT_DISCOVERY_ADAPTERS: ProjectDiscoveryAdapter[] = [
  new ClaudeProjectDiscoveryAdapter(),
  new CodexProjectDiscoveryAdapter(),
]

export function discoverProjects(
  homeDir: string = homedir(),
  adapters: ProjectDiscoveryAdapter[] = DEFAULT_PROJECT_DISCOVERY_ADAPTERS
): DiscoveredProject[] {
  return mergeDiscoveredProjects(adapters.flatMap((adapter) => adapter.scan(homeDir)))
}
