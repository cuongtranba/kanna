import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  command: z.string(),
})

export type BashInput = z.infer<typeof InputSchema>

export interface BashTool {
  name: "bash"
  schema: typeof InputSchema
  handler: (input: BashInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

const OUTPUT_CAP = 1_000_000 // 1 MB per stream

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

export function createBashTool(deps: { toolCallback: ToolCallbackService }): BashTool {
  return {
    name: "bash",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__bash",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
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
          return {
            content: [{ type: "text" as const, text }],
            isError: exitCode !== 0,
          }
        },
        formatDeny: (reason) => ({
          content: [{ type: "text" as const, text: `Denied: ${reason}` }],
          isError: true,
        }),
      })
    },
  }
}
