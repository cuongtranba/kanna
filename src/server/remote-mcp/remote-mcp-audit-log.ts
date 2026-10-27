import path from "node:path"
import { onRejected } from "../../shared/errors"
import { log } from "../../shared/log"
import { createSerialQueue } from "../serial-lane"
import type { StorageBackend } from "../storage/backend"
import type { RemoteMcpAuditSink } from "./remote-mcp-audit"

export const AUDIT_FILE_NAME = "remote-mcp-calls.jsonl"
export const AUDIT_ROTATE_BYTES = 10 * 1024 * 1024

export interface RemoteMcpAuditLog extends RemoteMcpAuditSink {
  flush(): Promise<void>
}

export interface RemoteMcpAuditLogOptions {
  storage: StorageBackend
  dataDir: string
  maxBytes?: number
}

export function createRemoteMcpAuditLog({ storage, dataDir, maxBytes = AUDIT_ROTATE_BYTES }: RemoteMcpAuditLogOptions): RemoteMcpAuditLog {
  const file = path.join(dataDir, AUDIT_FILE_NAME)
  const queue = createSerialQueue()

  async function append(line: string): Promise<void> {
    await storage.mkdir(dataDir)
    if (await storage.size(file) > maxBytes) await storage.rename(file, `${file}.1`)
    await storage.appendText(file, line)
  }

  return {
    record(entry) {
      const line = `${JSON.stringify(entry)}\n`
      queue.run(() => append(line)).catch(onRejected((error) => {
        log.warn("[remote-mcp] audit write failed", error.message)
      }))
    },
    flush: () => queue.run(async () => {}),
  }
}
