import { z } from "zod"
import { fail, ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"

const SHAPE = {
  command: z.string(),
}

const OUTPUT_CAP = 1_000_000

async function readBounded(stream: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!stream) return ""
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  reader.cancel().catch(() => {})
  let text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString("utf8")
  if (total >= maxBytes) text += "\n\n[output truncated at 1 MB]"
  return text
}

export function createBashTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "bash",
    shape: SHAPE,
    async run(input, ctx) {
      const proc = Bun.spawn(["/bin/sh", "-c", input.command], {
        cwd: ctx.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
        readBounded(proc.stdout, OUTPUT_CAP),
        readBounded(proc.stderr, OUTPUT_CAP),
        proc.exited,
      ])
      const text = [
        stdoutBuf,
        stderrBuf ? `STDERR:\n${stderrBuf}` : "",
        `Exit code: ${exitCode}`,
      ].filter(Boolean).join("\n")
      return exitCode === 0 ? ok(text) : fail(text)
    },
  })
}
