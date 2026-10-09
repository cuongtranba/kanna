import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, open, realpath, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { isPathInsideRoots } from "../shared/beacon-scope"
import {
  TRANSFER_CHUNK_ATTEMPTS,
  TRANSFER_CHUNK_BYTES,
  TRANSFER_COMPLETE_ROUTE,
  TRANSFER_KEEPALIVE_MS,
  TRANSFER_PART_SUFFIX,
  TRANSFER_REQUEST_TIMEOUT_MS,
  TRANSFER_ROUTE,
  isFatalTransferStatus,
  transferRetryDelayMs,
  type BeaconTransferResult,
} from "../shared/beacon-transfer"
import { errorMessage } from "../shared/errors"
import { isJsonObject, safeJsonParse } from "../shared/json"
import { BeaconScopeError, type BeaconTransferPort } from "./ports"
import { containedRealpath, denied, realRoots } from "./fs.adapter"

export interface BeaconTransferDeps {
  kannaUrl: string
  beaconVersion: string
  getReadRoots: () => readonly string[]
  getWriteRoots: () => readonly string[]
  chunkBytes?: number
  requestTimeoutMs?: number
  keepAliveMs?: number
  sleep?: (ms: number) => Promise<void>
}

class TransferFatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TransferFatalError"
  }
}

class TransferResumeError extends Error {
  constructor(readonly received: number) {
    super("the server asked to resume from a different offset")
    this.name = "TransferResumeError"
  }
}

function isMissing(error: Error): boolean {
  return "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")
}

async function describeFailure(response: Response): Promise<string> {
  const text = await response.text()
  const parsed = safeJsonParse(text)
  const reason = parsed !== null && isJsonObject(parsed) && typeof parsed.error === "string" ? parsed.error : text.trim()
  return reason === "" ? `HTTP ${String(response.status)}` : `HTTP ${String(response.status)}: ${reason}`
}

async function readReceived(response: Response): Promise<number | null> {
  const parsed = safeJsonParse(await response.text())
  if (parsed === null || !isJsonObject(parsed)) return null
  const { received } = parsed
  return typeof received === "number" && Number.isSafeInteger(received) && received >= 0 ? received : null
}

async function digestOf(path: string, onPiece?: () => Promise<void>): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const piece of createReadStream(path)) {
    const buffer: Buffer = typeof piece === "string" ? Buffer.from(piece) : piece
    hash.update(buffer)
    bytes += buffer.byteLength
    await onPiece?.()
  }
  return { bytes, sha256: hash.digest("hex") }
}

interface WriteTarget {
  target: string
}

async function resolveWriteTarget(path: string, roots: readonly string[]): Promise<WriteTarget> {
  const allowed = await realRoots(roots)
  const rest: string[] = []
  let current = path
  for (;;) {
    try {
      const real = await realpath(current)
      const target = join(real, ...rest)
      if (!isPathInsideRoots(real, allowed)) throw denied(path, "write")
      return { target }
    } catch (error) {
      if (error instanceof BeaconScopeError) throw error
      if (!(error instanceof Error) || !isMissing(error)) throw error
      const parent = dirname(current)
      if (parent === current) throw denied(path, "write")
      rest.unshift(basename(current))
      current = parent
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && isMissing(error)) return false
    throw error
  }
}

export function createBeaconTransfer(deps: BeaconTransferDeps): BeaconTransferPort {
  const base = deps.kannaUrl.replace(/\/+$/, "")
  const chunkBytes = deps.chunkBytes ?? TRANSFER_CHUNK_BYTES
  const requestTimeoutMs = deps.requestTimeoutMs ?? TRANSFER_REQUEST_TIMEOUT_MS
  const keepAliveMs = deps.keepAliveMs ?? TRANSFER_KEEPALIVE_MS
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  function request(ticket: string, route: string, init: RequestInit): Promise<Response> {
    return fetch(`${base}${route}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${ticket}`,
        "user-agent": `kanna-beacon/${deps.beaconVersion}`,
      },
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  }

  async function withRetries<TValue>(attempt: () => Promise<TValue>): Promise<TValue> {
    let failure: Error | null = null
    for (let tried = 1; tried <= TRANSFER_CHUNK_ATTEMPTS; tried += 1) {
      try {
        return await attempt()
      } catch (error) {
        if (error instanceof TransferFatalError || error instanceof TransferResumeError) throw error
        failure = error instanceof Error ? error : new Error(errorMessage(error))
        if (tried < TRANSFER_CHUNK_ATTEMPTS) await sleep(transferRetryDelayMs(tried))
      }
    }
    throw failure ?? new Error("transfer failed")
  }

  async function failFromStatus(response: Response): Promise<never> {
    const message = await describeFailure(response)
    if (isFatalTransferStatus(response.status)) throw new TransferFatalError(message)
    throw new Error(message)
  }

  async function resumePoint(ticket: string): Promise<number> {
    return withRetries(async () => {
      const response = await request(ticket, TRANSFER_ROUTE, { method: "GET" })
      if (!response.ok) return failFromStatus(response)
      const received = await readReceived(response)
      if (received === null) throw new Error("the server sent no resume point")
      return received
    })
  }

  function keepAliveWhile(probe: () => Promise<void>): () => Promise<void> {
    let last = Date.now()
    return async () => {
      if (Date.now() - last < keepAliveMs) return
      last = Date.now()
      await probe()
    }
  }

  async function putChunk(ticket: string, path: string, offset: number, end: number): Promise<number> {
    return withRetries(async () => {
      const response = await request(ticket, `${TRANSFER_ROUTE}?offset=${String(offset)}`, {
        method: "PUT",
        body: Bun.file(path).slice(offset, end),
      })
      if (response.status === 409) {
        const received = await readReceived(response)
        if (received === null) throw new Error("the server sent no resume point")
        throw new TransferResumeError(received)
      }
      if (!response.ok) return failFromStatus(response)
      const received = await readReceived(response)
      if (received === null) throw new Error("the server sent no resume point")
      return received
    })
  }

  async function sendChunks(ticket: string, real: string, size: number): Promise<void> {
    let offset = Math.min(await resumePoint(ticket), size)
    let resumes = 0
    while (offset < size) {
      const end = Math.min(offset + chunkBytes, size)
      try {
        offset = Math.min(await putChunk(ticket, real, offset, end), size)
        resumes = 0
      } catch (error) {
        if (!(error instanceof TransferResumeError)) throw error
        resumes += 1
        if (error.received > size) throw new TransferFatalError("the server holds more data than this file has")
        if (resumes >= TRANSFER_CHUNK_ATTEMPTS) throw new TransferFatalError("the server keeps disagreeing about the resume point")
        offset = error.received
      }
    }
  }

  async function completeUpload(ticket: string, size: number, sha256: string): Promise<void> {
    await withRetries(async () => {
      const response = await request(ticket, TRANSFER_COMPLETE_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bytes: size, sha256 }),
      })
      if (!response.ok) return failFromStatus(response)
      await response.text()
    })
  }

  async function upload(args: { path: string; ticket: string }): Promise<BeaconTransferResult> {
    const real = await containedRealpath(args.path, deps.getReadRoots())
    const info = await stat(real)
    if (!info.isFile()) throw new Error(`not a regular file: ${args.path}`)
    const digest = await digestOf(real, keepAliveWhile(async () => void (await resumePoint(args.ticket))))
    await sendChunks(args.ticket, real, digest.bytes)
    await completeUpload(args.ticket, digest.bytes, digest.sha256)
    return { path: real, bytes: digest.bytes, sha256: digest.sha256 }
  }

  async function touchDownload(ticket: string): Promise<void> {
    await withRetries(async () => {
      const response = await request(ticket, TRANSFER_ROUTE, { method: "GET", headers: { range: "bytes=0-0" } })
      if (response.status !== 206) return failFromStatus(response)
      await response.arrayBuffer()
    })
  }

  async function fetchRange(ticket: string, part: Awaited<ReturnType<typeof open>>, offset: number, end: number): Promise<void> {
    await withRetries(async () => {
      await part.truncate(offset)
      const response = await request(ticket, TRANSFER_ROUTE, {
        method: "GET",
        headers: { range: `bytes=${String(offset)}-${String(end - 1)}` },
      })
      if (response.status !== 206) return failFromStatus(response)
      if (response.body === null) throw new Error("the server sent no data")
      const reader = response.body.getReader()
      let position = offset
      for (;;) {
        const piece = await reader.read()
        if (piece.done) break
        const written = await part.write(piece.value, 0, piece.value.byteLength, position)
        position += written.bytesWritten
        if (written.bytesWritten !== piece.value.byteLength) throw new Error("short write")
      }
      if (position !== end) throw new Error(`the server sent ${String(position - offset)} of ${String(end - offset)} bytes`)
    })
  }

  async function download(args: {
    path: string
    ticket: string
    size: number
    sha256: string
    overwrite: boolean
  }): Promise<BeaconTransferResult> {
    const { target } = await resolveWriteTarget(args.path, deps.getWriteRoots())
    if (await exists(target)) {
      if ((await stat(target)).isDirectory()) throw new Error(`the destination is a directory: ${args.path}`)
      if (!args.overwrite) throw new Error(`the destination already exists: ${args.path}`)
    }
    await mkdir(dirname(target), { recursive: true })
    const partPath = `${target}${TRANSFER_PART_SUFFIX}`
    const part = await open(partPath, "w")
    try {
      for (let offset = 0; offset < args.size; offset += chunkBytes) {
        await fetchRange(args.ticket, part, offset, Math.min(offset + chunkBytes, args.size))
      }
      await part.close()
      const digest = await digestOf(partPath, keepAliveWhile(() => touchDownload(args.ticket)))
      if (digest.bytes !== args.size) throw new Error(`received ${String(digest.bytes)} of ${String(args.size)} bytes`)
      if (digest.sha256 !== args.sha256) throw new Error("the downloaded file's checksum does not match")
      if (!args.overwrite && (await exists(target))) throw new Error(`the destination already exists: ${args.path}`)
      await rename(partPath, target)
      return { path: target, bytes: digest.bytes, sha256: digest.sha256 }
    } catch (error) {
      await part.close().catch(() => undefined)
      await rm(partPath, { force: true })
      throw error
    }
  }

  return { upload, download }
}
