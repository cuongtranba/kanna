import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"
import {
  beaconFileName,
  defaultPullPath,
  numberedName,
  partPathOf,
  type BeaconTransferFiles,
  type FileDigest,
  type PullDestination,
  type PullDestinationRequest,
  type PushSource,
  type TransferPathOutcome,
} from "./beacon-transfer-files"
import { isPathInside } from "./path-containment"

const WINDOWS_DRIVE = /^[A-Za-z]:/
const MAX_NUMBERED_COPIES = 1000

function isMissing(error: Error): boolean {
  return "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")
}

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function workspaceRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/")
}

function isAbsoluteLike(candidate: string): boolean {
  return path.isAbsolute(candidate) || WINDOWS_DRIVE.test(candidate) || candidate.startsWith("~")
}

interface ResolvedTail {
  existing: string
  rest: readonly string[]
}

async function resolveThroughExistingAncestor(target: string): Promise<ResolvedTail> {
  const rest: string[] = []
  let current = target
  for (;;) {
    try {
      return { existing: await realpath(current), rest }
    } catch (error) {
      if (!(error instanceof Error) || !isMissing(error)) throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      rest.unshift(path.basename(current))
      current = parent
    }
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await lstat(candidate)
    return true
  } catch (error) {
    if (error instanceof Error && isMissing(error)) return false
    throw error
  }
}

async function firstFreeName(directory: string, fileName: string): Promise<string | null> {
  for (let copy = 1; copy <= MAX_NUMBERED_COPIES; copy += 1) {
    const candidate = path.join(directory, numberedName(fileName, copy))
    if (!(await exists(candidate))) return candidate
  }
  return null
}

async function resolveContained(
  root: string,
  relative: string,
  subject: string,
): Promise<TransferPathOutcome<{ kannaPath: string; present: boolean }>> {
  if (relative === "" || isAbsoluteLike(relative)) return refuse(`${subject} must be relative to the project root`)
  const lexical = path.resolve(root, relative)
  if (lexical === root || !isPathInside(root, lexical)) return refuse(`${subject} escapes the project root`)
  const tail = await resolveThroughExistingAncestor(lexical)
  const kannaPath = path.join(tail.existing, ...tail.rest)
  if (!isPathInside(root, kannaPath)) return refuse(`${subject} resolves outside the project root`)
  return { ok: true, kannaPath, present: tail.rest.length === 0 }
}

async function resolvePullDestination(request: PullDestinationRequest): Promise<TransferPathOutcome<PullDestination>> {
  const root = await realpath(request.projectRoot)
  const explicit = request.dest !== undefined && request.dest !== ""
  const relative = explicit ? (request.dest ?? "") : defaultPullPath(request.beaconPath)
  const resolved = await resolveContained(root, relative, "the path")
  if (!resolved.ok) return resolved
  if (resolved.present && (await stat(resolved.kannaPath)).isDirectory()) {
    return refuse("the destination is a directory; name the file to write")
  }
  if (!resolved.present || request.overwrite) {
    return { ok: true, kannaPath: resolved.kannaPath, workspacePath: workspaceRelative(root, resolved.kannaPath) }
  }
  if (explicit) return refuse(`${workspaceRelative(root, resolved.kannaPath)} already exists; pass overwrite: true to replace it`)
  const free = await firstFreeName(path.dirname(resolved.kannaPath), beaconFileName(request.beaconPath))
  if (free === null) return refuse("could not find a free file name in the uploads folder")
  return { ok: true, kannaPath: free, workspacePath: workspaceRelative(root, free) }
}

async function resolvePushSource(projectRoot: string, source: string): Promise<TransferPathOutcome<PushSource>> {
  const root = await realpath(projectRoot)
  const resolved = await resolveContained(root, source, "source")
  if (!resolved.ok) return resolved
  if (!resolved.present) return refuse(`no such file: ${source}`)
  const info = await stat(resolved.kannaPath)
  if (!info.isFile()) return refuse(`source is not a regular file: ${source}`)
  return { ok: true, kannaPath: resolved.kannaPath, workspacePath: workspaceRelative(root, resolved.kannaPath), size: info.size }
}

export async function hashFileStreaming(filePath: string, onPiece?: () => void): Promise<FileDigest> {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const piece of createReadStream(filePath)) {
    const buffer: Buffer = typeof piece === "string" ? Buffer.from(piece) : piece
    hash.update(buffer)
    bytes += buffer.byteLength
    onPiece?.()
  }
  return { bytes, sha256: hash.digest("hex") }
}

export function createBeaconTransferFiles(): BeaconTransferFiles {
  return {
    resolvePullDestination,
    resolvePushSource,
    hashFile: (filePath) => hashFileStreaming(filePath),
    discardPart: (kannaPath) => rm(partPathOf(kannaPath), { force: true }),
  }
}
