import { z } from "zod"
import { readdir, lstat } from "node:fs/promises"
import path from "node:path"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import { minimatch } from "minimatch"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
  pattern: z.string(),
})

export type GlobInput = z.infer<typeof InputSchema>

export interface GlobTool {
  name: "glob"
  schema: typeof InputSchema
  handler: (input: GlobInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

const SKIP_DIRS = new Set(["node_modules", ".git"])
const MAX_RESULTS = 1000

async function walkDir(root: string, results: string[]): Promise<void> {
  if (results.length >= MAX_RESULTS) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) break
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      try {
        const st = await lstat(full)
        if (st.isSymbolicLink()) continue
      } catch {
        continue
      }
      await walkDir(full, results)
    } else {
      results.push(full)
    }
  }
}

export function createGlobTool(deps: { toolCallback: ToolCallbackService }): GlobTool {
  return {
    name: "glob",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__glob",
        ctx,
        args: input,
        formatAnswer: async () => {
          const root = resolveUserPath(input.path, ctx.cwd, currentHomeDir())
          const allFiles: string[] = []
          await walkDir(root, allFiles)
          const matches = allFiles
            .map((f) => path.relative(root, f))
            .filter((rel) => minimatch(rel, input.pattern, { dot: true }))
          return {
            content: [{ type: "text" as const, text: matches.join("\n") }],
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
