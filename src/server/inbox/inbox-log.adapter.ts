import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { parseInboxEvent, type InboxEvent } from "../../shared/inbox/events"
import { safeJsonParse } from "../../shared/json"
import type { InboxLogPort } from "./inbox-registry"

const INBOX_LOG_FILE = "inbox.jsonl"

function parseLines(text: string): InboxEvent[] {
  const events: InboxEvent[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const parsed = safeJsonParse(line)
    const event = parsed === null ? null : parseInboxEvent(parsed)
    if (event !== null) events.push(event)
  }
  return events
}

export function createFileInboxLog(dataDir: string): InboxLogPort {
  const file = path.join(dataDir, INBOX_LOG_FILE)
  return {
    async append(event) {
      await mkdir(dataDir, { recursive: true })
      await appendFile(file, `${JSON.stringify(event)}\n`, "utf8")
    },
    async readAll() {
      try {
        return parseLines(await readFile(file, "utf8"))
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
        throw error
      }
    },
    async rewrite(events) {
      await mkdir(dataDir, { recursive: true })
      const temp = `${file}.tmp`
      await writeFile(temp, events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8")
      await rename(temp, file)
    },
  }
}
