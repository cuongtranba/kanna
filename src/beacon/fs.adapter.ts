import { createHash, type Hash } from "node:crypto"
import { open, readdir, realpath, stat } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { isPathInsideRoots } from "../shared/beacon-scope"
import type { JsonValue } from "../shared/json"
import { BeaconScopeError, type BeaconFsPort } from "./ports"

const BINARY_SNIFF_BYTES = 8192
const MAX_READ_BYTES = 4 * 1024 * 1024
const FETCH_CHUNK_BYTES = 256 * 1024
const MAX_GLOB_MATCHES = 1000
const MAX_GREP_MATCHES = 500
const MAX_GREP_FILES = 20000
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024
const MAX_GREP_LINE_CHARS = 400
const MAX_HASH_CACHE = 8
const GLOB_CHARS = /[*?[\]{}]/

interface HashProgress {
  hash: Hash
  position: number
}

function isMissing(error: Error): boolean {
  return "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")
}

export async function realRoots(roots: readonly string[]): Promise<string[]> {
  const resolved: string[] = []
  for (const root of roots) {
    try {
      resolved.push(await realpath(root))
    } catch {
      continue
    }
  }
  return resolved
}

export async function nearestExistingRealpath(path: string): Promise<string | null> {
  let current = resolve(path)
  for (;;) {
    try {
      return await realpath(current)
    } catch (error) {
      if (!(error instanceof Error) || !isMissing(error)) throw error
      const parent = dirname(current)
      if (parent === current) return null
      current = parent
    }
  }
}

export function denied(path: string, kind: "read" | "write" = "read"): BeaconScopeError {
  return new BeaconScopeError(`path is outside the permitted ${kind} roots: ${path}`)
}

export async function containedRealpath(path: string, roots: readonly string[]): Promise<string> {
  const allowed = await realRoots(roots)
  let real: string
  try {
    real = await realpath(path)
  } catch (error) {
    if (!(error instanceof Error) || !isMissing(error)) throw error
    const ancestor = await nearestExistingRealpath(path)
    if (ancestor === null || !isPathInsideRoots(ancestor, allowed)) throw denied(path)
    throw new Error(`no such file or directory: ${path}`, { cause: error })
  }
  if (!isPathInsideRoots(real, allowed)) throw denied(path)
  return real
}

async function isBinaryFile(path: string, size: number): Promise<boolean> {
  const handle = await open(path, "r")
  try {
    const sample = Buffer.alloc(Math.min(BINARY_SNIFF_BYTES, size))
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    return sample.subarray(0, bytesRead).includes(0)
  } finally {
    await handle.close()
  }
}

async function readWindow(path: string, offset: number, length: number): Promise<Buffer> {
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function collectFiles(root: string, files: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (files.length >= MAX_GREP_FILES) return
    const full = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) await collectFiles(full, files)
    else if (entry.isFile()) files.push(full)
  }
}

async function grepFile(path: string, matcher: RegExp, budget: number): Promise<JsonValue[]> {
  const info = await stat(path)
  if (info.size > MAX_GREP_FILE_BYTES || (await isBinaryFile(path, info.size))) return []
  const text = (await readWindow(path, 0, info.size)).toString("utf8")
  const found: JsonValue[] = []
  const lines = text.split("\n")
  for (let index = 0; index < lines.length && found.length < budget; index += 1) {
    const line = lines[index] ?? ""
    if (matcher.test(line)) found.push({ path, line: index + 1, text: line.slice(0, MAX_GREP_LINE_CHARS) })
  }
  return found
}

function splitGlob(pattern: string): { base: string; relative: string } {
  const segments = pattern.split("/")
  const firstGlob = segments.findIndex((segment) => GLOB_CHARS.test(segment))
  if (firstGlob === -1) return { base: pattern, relative: "" }
  const base = segments.slice(0, firstGlob).join("/")
  return { base: base === "" ? "/" : base, relative: segments.slice(firstGlob).join("/") }
}

export function createBeaconFs(getReadRoots: () => readonly string[]): BeaconFsPort {
  const hashCache = new Map<string, HashProgress>()

  async function contained(path: string): Promise<string> {
    return containedRealpath(path, getReadRoots())
  }

  async function hashThrough(real: string, from: number): Promise<HashProgress> {
    const cached = hashCache.get(real)
    if (cached && cached.position === from) return cached
    const hash = createHash("sha256")
    let position = 0
    while (position < from) {
      const piece = await readWindow(real, position, Math.min(FETCH_CHUNK_BYTES, from - position))
      if (piece.length === 0) break
      hash.update(piece)
      position += piece.length
    }
    return { hash, position }
  }

  function remember(real: string, progress: HashProgress): void {
    hashCache.delete(real)
    hashCache.set(real, progress)
    if (hashCache.size > MAX_HASH_CACHE) {
      const oldest = hashCache.keys().next()
      if (!oldest.done) hashCache.delete(oldest.value)
    }
  }

  return {
    async read(path, offset, limit) {
      const real = await contained(path)
      const info = await stat(real)
      if (await isBinaryFile(real, info.size)) {
        return { content: "", totalSize: info.size, truncated: false, binary: true }
      }
      const start = Math.max(0, offset)
      const length = Math.max(0, Math.min(limit, MAX_READ_BYTES, info.size - start))
      const window = await readWindow(real, start, length)
      return {
        content: window.toString("utf8"),
        totalSize: info.size,
        truncated: start + window.length < info.size,
        binary: false,
      }
    },
    async stat(path) {
      const real = await contained(path)
      const info = await stat(real)
      return {
        path: real,
        size: info.size,
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        mtimeMs: info.mtimeMs,
      }
    },
    async glob(pattern) {
      const { base, relative } = splitGlob(pattern)
      const real = await contained(base)
      if (relative === "") return { matches: [real], truncated: false }
      const matches: string[] = []
      let truncated = false
      for await (const entry of new Bun.Glob(relative).scan({ cwd: real, onlyFiles: false })) {
        if (matches.length >= MAX_GLOB_MATCHES) {
          truncated = true
          break
        }
        matches.push(join(real, entry))
      }
      return { matches, truncated }
    },
    async grep(root, pattern) {
      const real = await contained(root)
      const matcher = new RegExp(pattern)
      const files: string[] = []
      await collectFiles(real, files)
      const matches: JsonValue[] = []
      for (const file of files) {
        if (matches.length >= MAX_GREP_MATCHES) break
        matches.push(...(await grepFile(file, matcher, MAX_GREP_MATCHES - matches.length)))
      }
      return { matches, truncated: matches.length >= MAX_GREP_MATCHES || files.length >= MAX_GREP_FILES }
    },
    async fetchChunk(path, from) {
      const real = await contained(path)
      const info = await stat(real)
      const start = Math.max(0, Math.min(from, info.size))
      const progress = await hashThrough(real, start)
      const chunk = await readWindow(real, start, Math.min(FETCH_CHUNK_BYTES, info.size - start))
      progress.hash.update(chunk)
      const nextFrom = start + chunk.length
      const next: HashProgress = { hash: progress.hash, position: nextFrom }
      remember(real, next)
      return {
        data: chunk.toString("base64"),
        from: start,
        nextFrom,
        totalSize: info.size,
        done: nextFrom >= info.size,
        sha256: next.hash.copy().digest("hex"),
      }
    },
  }
}
