import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { getBeaconTransferTickets } from "./beacon-transfer-host"
import type { TransferTicketSpec } from "./beacon-transfer-tickets"
import { startKannaServer } from "./server"

const CHUNK = 4096

let dataDir = ""
let workDir = ""
let base = ""
let stopServer: () => Promise<void> = async () => undefined

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "kanna-transfer-data-"))
  workDir = await mkdtemp(path.join(tmpdir(), "kanna-transfer-work-"))
  const server = await startKannaServer({
    dataDir,
    port: 0,
    password: "secret",
    openBrowser: false,
    discoverProjects: () => [],
  })
  base = `http://127.0.0.1:${String(server.port)}`
  stopServer = server.stop
})

afterAll(async () => {
  await stopServer()
  await rm(dataDir, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
})

function patternBytes(size: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(size).map((_, index) => (index * 31 + 7) % 251)
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function mintUpload(destination: string, overrides: Partial<TransferTicketSpec> = {}) {
  return getBeaconTransferTickets().mint({
    beaconId: "b1",
    chatId: "c1",
    direction: "upload",
    kannaPath: destination,
    workspacePath: path.basename(destination),
    beaconPath: "/remote/file.bin",
    overwrite: false,
    ...overrides,
  })
}

function put(token: string, offset: number, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetch(`${base}/beacon/transfer?offset=${String(offset)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}` },
    body,
  })
}

function complete(token: string, bytes: number, digest: string): Promise<Response> {
  return fetch(`${base}/beacon/transfer/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ bytes, sha256: digest }),
  })
}

describe("beacon transfer endpoint", () => {
  test("a chunked upload resumes after a 409 and lands verified at the destination", async () => {
    const bytes = patternBytes(CHUNK * 2 + 123)
    const destination = path.join(workDir, "resumed.bin")
    const ticket = mintUpload(destination)

    const first = await put(ticket.token, 0, bytes.slice(0, CHUNK))
    expect(await first.json()).toEqual({ received: CHUNK })
    const skipped = await put(ticket.token, CHUNK * 2, bytes.slice(CHUNK * 2))
    expect(skipped.status).toBe(409)
    expect(await skipped.json()).toEqual({ received: CHUNK })
    const resumePoint = await fetch(`${base}/beacon/transfer`, { headers: { authorization: `Bearer ${ticket.token}` } })
    expect(await resumePoint.json()).toEqual({ direction: "upload", received: CHUNK })
    await put(ticket.token, CHUNK, bytes.slice(CHUNK, CHUNK * 2))
    await put(ticket.token, CHUNK * 2, bytes.slice(CHUNK * 2))

    const done = await complete(ticket.token, bytes.byteLength, sha256(bytes))
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ path: "resumed.bin", bytes: bytes.byteLength, sha256: sha256(bytes) })
    expect(new Uint8Array(await readFile(destination))).toEqual(bytes)
    expect((await readdir(workDir)).filter((name) => name.endsWith(".kanna-part"))).toEqual([])
  })

  test("a repeated complete after success answers 200 with the same body", async () => {
    const bytes = patternBytes(CHUNK + 5)
    const ticket = mintUpload(path.join(workDir, "replayed.bin"))
    await put(ticket.token, 0, bytes)
    const expected = { path: "replayed.bin", bytes: bytes.byteLength, sha256: sha256(bytes) }
    expect(await (await complete(ticket.token, bytes.byteLength, sha256(bytes))).json()).toEqual(expected)

    const retried = await complete(ticket.token, bytes.byteLength, sha256(bytes))

    expect(retried.status).toBe(200)
    expect(await retried.json()).toEqual(expected)
  })

  test("a wrong checksum is refused with 422 and writes no destination file", async () => {
    const bytes = patternBytes(CHUNK)
    const destination = path.join(workDir, "corrupt.bin")
    const ticket = mintUpload(destination)
    await put(ticket.token, 0, bytes)

    const refused = await complete(ticket.token, bytes.byteLength, "0".repeat(64))

    expect(refused.status).toBe(422)
    expect(await Bun.file(destination).exists()).toBe(false)
    const afterwards = await put(ticket.token, 0, bytes)
    expect(afterwards.status).toBe(401)
  })

  test("a revoked ticket gets 401 on every route", async () => {
    const ticket = mintUpload(path.join(workDir, "revoked.bin"))
    getBeaconTransferTickets().revoke(ticket.token)
    const headers = { authorization: `Bearer ${ticket.token}` }

    expect((await fetch(`${base}/beacon/transfer`, { headers })).status).toBe(401)
    expect((await put(ticket.token, 0, patternBytes(8))).status).toBe(401)
    expect((await complete(ticket.token, 0, sha256(new Uint8Array()))).status).toBe(401)
  })

  test("a ranged download streams exactly the requested bytes of the project file", async () => {
    const bytes = patternBytes(CHUNK * 3)
    const source = path.join(workDir, "source.bin")
    await writeFile(source, bytes)
    const ticket = getBeaconTransferTickets().mint({
      beaconId: "b1",
      chatId: "c1",
      direction: "download",
      kannaPath: source,
      workspacePath: "source.bin",
      beaconPath: "/remote/out.bin",
      size: bytes.byteLength,
      sha256: sha256(bytes),
      overwrite: false,
    })

    const response = await fetch(`${base}/beacon/transfer`, {
      headers: { authorization: `Bearer ${ticket.token}`, range: `bytes=${String(CHUNK)}-${String(CHUNK * 2 - 1)}` },
    })

    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe(`bytes ${String(CHUNK)}-${String(CHUNK * 2 - 1)}/${String(bytes.byteLength)}`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(CHUNK, CHUNK * 2))
  })
})
