import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export interface FakeAnthropicOptions {
  streamMs: number
  deltaIntervalMs: number
}

export interface FakeAnthropic {
  baseUrl: string
  streamsStarted: () => number
  stop: () => Promise<void>
}

const STREAM_PARAGRAPHS = [
  "Here is a long streamed answer so the client renders a live block for many seconds.",
  "Each delta carries a few words, which is close to how a real model streams tokens.",
  "## A heading in the middle\n\n- a list item with `inline code`\n- another item that wraps onto a second line on a phone",
  "```ts\nexport function streamed(index: number): number {\n  const doubled = index * 2\n  return doubled + 1\n}\n```",
  "A closing paragraph that is long enough to wrap several times on a narrow screen and keep layout busy while it grows.",
]

function streamedText(totalDeltas: number): string[] {
  const words = STREAM_PARAGRAPHS.join("\n\n").split(/(?<=\s)/)
  const deltas: string[] = []
  let cursor = 0
  while (deltas.length < totalDeltas) {
    const take = 3
    let chunk = ""
    for (let k = 0; k < take; k++) {
      chunk += words[cursor % words.length]
      cursor++
      if (cursor % words.length === 0) chunk += "\n\n"
    }
    deltas.push(chunk)
  }
  return deltas
}

function sse(res: ServerResponse, event: string, data: object): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString("utf8")
}

export async function startFakeAnthropic(options: FakeAnthropicOptions): Promise<FakeAnthropic> {
  let streams = 0
  const sockets = new Set<import("node:net").Socket>()
  const server: Server = createServer((req, res) => {
    void (async () => {
      const raw = req.method === "POST" ? await readBody(req) : ""
      if (!req.url?.startsWith("/v1/messages") || req.url.includes("count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ input_tokens: 10 }))
        return
      }
      const body = raw ? JSON.parse(raw) : {}
      const isMainLoop = Array.isArray(body.tools) && body.tools.length > 0
      const model = typeof body.model === "string" ? body.model : "fake"
      const message = { id: `msg_${String(Date.now())}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } }
      if (!body.stream) {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ...message, content: [{ type: "text", text: "Benchmark chat" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 3 } }))
        return
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
      sse(res, "message_start", { type: "message_start", message })
      sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
      const deltas = isMainLoop ? streamedText(Math.max(1, Math.round(options.streamMs / options.deltaIntervalMs))) : ["Benchmark chat"]
      if (isMainLoop) streams++
      for (const text of deltas) {
        if (res.destroyed) return
        sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })
        if (isMainLoop) await new Promise((resolve) => setTimeout(resolve, options.deltaIntervalMs))
      }
      sse(res, "content_block_stop", { type: "content_block_stop", index: 0 })
      sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: deltas.length * 3 } })
      sse(res, "message_stop", { type: "message_stop" })
      res.end()
    })().catch((error: Error) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(error))
    })
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    streamsStarted: () => streams,
    stop: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
