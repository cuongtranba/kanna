import { existsSync, rmSync } from "node:fs"
import { createConnection, createServer, type Server } from "node:net"
import { isJsonObject, safeJsonParse } from "../../shared/json"

export type InstanceMessage = { kind: "show" } | { kind: "link"; url: string }

const NOTIFY_TIMEOUT_MS = 1_500

function parseMessage(line: string): InstanceMessage | null {
  const parsed = safeJsonParse(line)
  if (parsed === null || !isJsonObject(parsed)) return null
  if (parsed.kind === "show") return { kind: "show" }
  if (parsed.kind === "link" && typeof parsed.url === "string") return { kind: "link", url: parsed.url }
  return null
}

export function notifyRunningInstance(endpoint: string, message: InstanceMessage): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (delivered: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(delivered)
    }
    const socket = createConnection(endpoint, () => {
      socket.write(`${JSON.stringify(message)}\n`)
    })
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => finish(chunk.startsWith("ok")))
    socket.on("error", () => finish(false))
    socket.on("close", () => finish(false))
    const timer = setTimeout(() => finish(false), NOTIFY_TIMEOUT_MS)
  })
}

function removeStaleSocket(endpoint: string): void {
  if (endpoint.startsWith("\\\\.\\pipe\\")) return
  if (existsSync(endpoint)) rmSync(endpoint, { force: true })
}

export function listenAsPrimaryInstance(
  endpoint: string,
  onMessage: (message: InstanceMessage) => void,
): Promise<{ close(): void }> {
  removeStaleSocket(endpoint)
  const server: Server = createServer((socket) => {
    let buffer = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf("\n")
      if (newline === -1) return
      const message = parseMessage(buffer.slice(0, newline))
      socket.end(message === null ? "rejected\n" : "ok\n")
      if (message !== null) onMessage(message)
    })
    socket.on("error", () => socket.destroy())
  })
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, () => {
      server.off("error", reject)
      resolve({ close: () => server.close() })
    })
  })
}
