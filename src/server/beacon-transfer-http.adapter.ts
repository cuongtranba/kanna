import { constants } from "node:fs"
import { mkdir, open, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { errorMessage } from "../shared/errors"
import { isJsonObject, safeJsonParse } from "../shared/json"
import {
  SHA256_HEX,
  TRANSFER_COMPLETE_ROUTE,
  TRANSFER_MAX_CHUNK_BYTES,
  TRANSFER_ROUTE,
} from "../shared/beacon-transfer"
import { hashFileStreaming } from "./beacon-transfer-files.adapter"
import { partPathOf } from "./beacon-transfer-files"
import type { BeaconTransferTickets, TransferOutcome, TransferTicket } from "./beacon-transfer-tickets"
import { buildFileResponse } from "./http-file-response"

const DIGITS = /^\d+$/
const BEARER = /^Bearer\s+(\S+)$/i

function unauthorized(): Response {
  return Response.json({ error: "invalid ticket" }, { status: 401 })
}

function bearerToken(req: Request): string | null {
  const match = BEARER.exec(req.headers.get("authorization") ?? "")
  return match?.[1] ?? null
}

function wholeNumber(raw: string | null): number | null {
  if (raw === null || !DIGITS.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : null
}

async function sizeOrZero(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0
    throw error
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function touchingStream(source: ReadableStream<Uint8Array>, onPiece: () => void): ReadableStream<Uint8Array> {
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const piece = await reader.read()
      if (piece.done) {
        controller.close()
        return
      }
      onPiece()
      controller.enqueue(piece.value)
    },
    cancel: (reason) => reader.cancel(reason),
  })
}

async function writeFully(handle: Awaited<ReturnType<typeof open>>, piece: Uint8Array, position: number): Promise<void> {
  let written = 0
  while (written < piece.byteLength) {
    const result = await handle.write(piece, written, piece.byteLength - written, position + written)
    written += result.bytesWritten
  }
}

async function streamIntoPart(args: {
  tickets: BeaconTransferTickets
  ticket: TransferTicket
  offset: number
  length: number
  body: ReadableStream<Uint8Array> | null
}): Promise<number> {
  const { tickets, ticket, offset, length, body } = args
  const part = partPathOf(ticket.kannaPath)
  await mkdir(path.dirname(part), { recursive: true })
  const handle = await open(part, constants.O_RDWR | constants.O_CREAT)
  let position = offset
  try {
    if (body !== null) {
      const reader = body.getReader()
      for (;;) {
        const piece = await reader.read()
        if (piece.done) break
        tickets.touch(ticket.token)
        await writeFully(handle, piece.value, position)
        position += piece.value.byteLength
        if (position - offset > length) throw new Error("body is longer than its Content-Length")
      }
    }
    if (position - offset !== length) throw new Error("body is shorter than its Content-Length")
    return position
  } catch (error) {
    await handle.truncate(offset)
    throw error
  } finally {
    await handle.close()
  }
}

export function createBeaconTransferHandler(
  tickets: BeaconTransferTickets,
  maxChunkBytes: number = TRANSFER_MAX_CHUNK_BYTES,
): (req: Request, url: URL) => Promise<Response> {
  const writing = new Set<string>()
  const completing = new Map<string, Promise<void>>()

  async function resumePoint(token: string): Promise<Response> {
    const ticket = tickets.lookup(token, "upload")
    if (ticket === null) return unauthorized()
    tickets.touch(token)
    const received = await sizeOrZero(partPathOf(ticket.kannaPath))
    return Response.json({ direction: "upload", received })
  }

  async function rangedDownload(req: Request, token: string): Promise<Response> {
    const ticket = tickets.lookup(token, "download")
    if (ticket === null) return unauthorized()
    tickets.touch(token)
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(ticket.kannaPath)
    } catch {
      return Response.json({ error: "the file is no longer available" }, { status: 404 })
    }
    if (!info.isFile()) return Response.json({ error: "the file is no longer available" }, { status: 404 })
    const response = buildFileResponse({
      req,
      file: Bun.file(ticket.kannaPath),
      size: info.size,
      mtimeMs: info.mtimeMs,
      contentType: "application/octet-stream",
    })
    if (response.body === null) return response
    const body = touchingStream(response.body, () => tickets.touch(token))
    return new Response(body, { status: response.status, headers: response.headers })
  }

  async function putChunk(req: Request, url: URL, token: string): Promise<Response> {
    const ticket = tickets.lookup(token, "upload")
    if (ticket === null) return unauthorized()
    tickets.touch(token)
    const offset = wholeNumber(url.searchParams.get("offset"))
    if (offset === null) return Response.json({ error: "offset must be a whole number" }, { status: 400 })
    const length = wholeNumber(req.headers.get("content-length"))
    if (length === null) return Response.json({ error: "Content-Length is required" }, { status: 411 })
    if (length > maxChunkBytes) return Response.json({ error: "chunk is too large" }, { status: 413 })
    if (ticket.maxBytes !== undefined && offset + length > ticket.maxBytes) {
      return Response.json({ error: "the file is larger than the upload limit" }, { status: 413 })
    }
    const received = await sizeOrZero(partPathOf(ticket.kannaPath))
    if (writing.has(token) || offset !== received) return Response.json({ received }, { status: 409 })
    writing.add(token)
    try {
      const next = await streamIntoPart({ tickets, ticket, offset, length, body: req.body })
      return Response.json({ received: next })
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 500 })
    } finally {
      writing.delete(token)
    }
  }

  async function rejectCompletion(ticket: TransferTicket, reason: string): Promise<Response> {
    tickets.fail(ticket.token)
    await rm(partPathOf(ticket.kannaPath), { force: true })
    return Response.json({ error: reason }, { status: 422 })
  }

  function completedUpload(token: string): TransferTicket | null {
    const ticket = tickets.inspect(token)
    return ticket !== null && ticket.state === "completed" && ticket.direction === "upload" && ticket.outcome !== undefined
      ? ticket
      : null
  }

  function completionClaim(text: string): TransferOutcome | null {
    const body = safeJsonParse(text)
    const claimedBytes = body !== null && isJsonObject(body) ? body.bytes : undefined
    const claimedSha = body !== null && isJsonObject(body) ? body.sha256 : undefined
    if (
      typeof claimedBytes !== "number" ||
      !Number.isSafeInteger(claimedBytes) ||
      claimedBytes < 0 ||
      typeof claimedSha !== "string" ||
      !SHA256_HEX.test(claimedSha)
    ) {
      return null
    }
    return { bytes: claimedBytes, sha256: claimedSha }
  }

  function replayCompletion(token: string, claim: TransferOutcome): Response {
    const ticket = completedUpload(token)
    if (ticket === null || ticket.outcome?.bytes !== claim.bytes || ticket.outcome.sha256 !== claim.sha256) {
      return unauthorized()
    }
    return Response.json({ path: ticket.workspacePath, bytes: claim.bytes, sha256: claim.sha256 })
  }

  async function settleCompletion(token: string, claim: TransferOutcome): Promise<Response> {
    const ticket = tickets.lookup(token, "upload")
    if (ticket === null) return replayCompletion(token, claim)
    tickets.touch(token)
    const part = partPathOf(ticket.kannaPath)
    await mkdir(path.dirname(part), { recursive: true })
    await (await open(part, constants.O_RDWR | constants.O_CREAT)).close()
    const digest = await hashFileStreaming(part, () => tickets.touch(token)).catch(() => null)
    if (digest === null || digest.bytes !== claim.bytes) {
      return rejectCompletion(ticket, "the received size does not match what the beacon reported")
    }
    if (digest.sha256 !== claim.sha256) return rejectCompletion(ticket, "the received checksum does not match")
    if (ticket.maxBytes !== undefined && digest.bytes > ticket.maxBytes) {
      return rejectCompletion(ticket, "the file is larger than the upload limit")
    }
    if (!ticket.overwrite && (await pathExists(ticket.kannaPath))) {
      return rejectCompletion(ticket, "the destination already exists")
    }
    await rename(part, ticket.kannaPath)
    tickets.complete(token, { bytes: digest.bytes, sha256: digest.sha256 })
    return Response.json({ path: ticket.workspacePath, bytes: digest.bytes, sha256: digest.sha256 })
  }

  async function complete(req: Request, token: string): Promise<Response> {
    if (tickets.lookup(token, "upload") === null && completedUpload(token) === null) return unauthorized()
    tickets.touch(token)
    const claim = completionClaim(await req.text())
    if (claim === null) return Response.json({ error: "bytes and sha256 are required" }, { status: 400 })
    const previous = completing.get(token) ?? Promise.resolve()
    const settled = previous.then(() => settleCompletion(token, claim))
    const tail = settled.then(
      () => undefined,
      () => undefined,
    )
    completing.set(token, tail)
    try {
      return await settled
    } finally {
      if (completing.get(token) === tail) completing.delete(token)
    }
  }

  return async function handle(req: Request, url: URL): Promise<Response> {
    const token = bearerToken(req)
    if (token === null) return unauthorized()
    try {
      if (url.pathname === TRANSFER_ROUTE) {
        if (req.method === "GET") return req.headers.has("range") ? await rangedDownload(req, token) : await resumePoint(token)
        if (req.method === "PUT") return await putChunk(req, url, token)
        return new Response(null, { status: 405, headers: { Allow: "GET, PUT" } })
      }
      if (url.pathname === TRANSFER_COMPLETE_ROUTE) {
        if (req.method === "POST") return await complete(req, token)
        return new Response(null, { status: 405, headers: { Allow: "POST" } })
      }
      return new Response(null, { status: 404 })
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 500 })
    }
  }
}
