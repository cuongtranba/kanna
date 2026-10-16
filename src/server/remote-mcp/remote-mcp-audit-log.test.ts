import { describe, expect, test } from "bun:test"
import { isJsonArray, isJsonObject } from "../../shared/json"
import { InMemoryStorageBackend } from "../storage/in-memory-storage"
import { auditArgs, type RemoteMcpAuditRecord } from "./remote-mcp-audit"
import { AUDIT_FILE_NAME, createRemoteMcpAuditLog } from "./remote-mcp-audit-log"

const DATA_DIR = "/data"
const FILE = `${DATA_DIR}/${AUDIT_FILE_NAME}`

function record(callId: string): RemoteMcpAuditRecord {
  return {
    at: "2026-10-16T09:12:32.000Z",
    callId,
    tool: "send_message",
    clientId: "client-1",
    via: "oauth",
    era: "modern",
    durationMs: 12,
    outcome: "ok",
    args: { content: "hi" },
  }
}

class RefusingStorage extends InMemoryStorageBackend {
  override async appendText(): Promise<void> {
    throw new Error("disk full")
  }
}

describe("remote MCP audit log", () => {
  test("appends one JSON line per tool call", async () => {
    const storage = new InMemoryStorageBackend()
    const audit = createRemoteMcpAuditLog({ storage, dataDir: DATA_DIR })

    audit.record(record("call-1"))
    audit.record(record("call-2"))
    await audit.flush()

    const lines = (await storage.readText(FILE)).trim().split("\n")
    expect(lines.map((line) => JSON.parse(line).callId)).toEqual(["call-1", "call-2"])
  })

  test("moves the log aside once it passes the size limit, keeping the newest calls in a fresh file", async () => {
    const storage = new InMemoryStorageBackend()
    const audit = createRemoteMcpAuditLog({ storage, dataDir: DATA_DIR, maxBytes: 200 })

    for (const id of ["call-1", "call-2", "call-3", "call-4"]) audit.record(record(id))
    await audit.flush()

    const current = (await storage.readText(FILE)).trim().split("\n").map((line) => JSON.parse(line).callId)
    const rotated = (await storage.readText(`${FILE}.1`)).trim().split("\n").map((line) => JSON.parse(line).callId)
    expect([...rotated, ...current]).toEqual(["call-1", "call-2", "call-3", "call-4"])
    expect(rotated.length).toBeGreaterThan(0)
    expect(current.length).toBeGreaterThan(0)
  })

  test("a log that cannot be written never throws into the tool call", async () => {
    const audit = createRemoteMcpAuditLog({ storage: new RefusingStorage(), dataDir: DATA_DIR })

    audit.record(record("call-1"))

    await expect(audit.flush()).resolves.toBeUndefined()
  })
})

describe("auditArgs", () => {
  test("redacts secrets and truncates long strings and lists", () => {
    const logged = auditArgs({
      content: "x".repeat(2000),
      apiKey: "sk-live-secret",
      attachments: Array.from({ length: 30 }, (_, index) => `file-${index}`),
    })

    expect(JSON.stringify(logged)).not.toContain("sk-live-secret")
    if (!isJsonObject(logged)) throw new Error("expected an object")
    expect(String(logged.content).length).toBeLessThan(600)
    expect(isJsonArray(logged.attachments) && logged.attachments.length).toBe(21)
  })
})
