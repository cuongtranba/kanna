import { z } from "zod"
import { readdir, readFile, lstat, stat } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  path: z.string(),
  pattern: z.string(),
})

export type GrepInput = z.infer<typeof InputSchema>

export interface GrepTool {
  name: "grep"
  schema: typeof InputSchema
  handler: (input: GrepInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

function resolvePath(p: string, cwd: string): string {
  if (p.startsWith("~")) return path.join(homedir(), p.slice(1).replace(/^\//, ""))
  return path.resolve(cwd, p)
}

const SKIP_DIRS = new Set(["node_modules", ".git"])
const MAX_LINES = 500
const MAX_FILE_SIZE = 1_000_000 // 1 MB

async function grepDir(root: string, re: RegExp, results: string[]): Promise<void> {
  if (results.length >= MAX_LINES) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (results.length >= MAX_LINES) break
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      // Symlink guard: skip symlinked directories to prevent traversal loops
      try {
        const st = await lstat(fullPath)
        if (st.isSymbolicLink()) continue
      } catch {
        continue
      }
      await grepDir(fullPath, re, results)
    } else {
      // Skip large files to prevent memory issues
      try {
        const fileStat = await stat(fullPath)
        if (fileStat.size > MAX_FILE_SIZE) continue
      } catch {
        continue
      }
      let content: string
      try {
        content = await readFile(fullPath, "utf8")
      } catch {
        continue
      }
      const lines = content.split("\n")
      for (let i = 0; i < lines.length && results.length < MAX_LINES; i++) {
        if (re.test(lines[i])) {
          results.push(`${fullPath}:${i + 1}: ${lines[i]}`)
        }
      }
    }
  }
}

async function grepWithTimeout(root: string, re: RegExp, results: string[]): Promise<void> {
  return await Promise.race([
    grepDir(root, re, results),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error("grep timeout 30s")), 30_000)),
  ])
}

export function createGrepTool(deps: { toolCallback: ToolCallbackService }): GrepTool {
  return {
    name: "grep",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__grep",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          let re: RegExp
          try {
            re = new RegExp(input.pattern)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Invalid regex pattern: ${msg}` }],
              isError: true,
            }
          }
          const root = resolvePath(input.path, ctx.cwd)
          const results: string[] = []
          try {
            await grepWithTimeout(root, re, results)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `grep error: ${msg}` }],
              isError: true,
            }
          }
          return {
            content: [{ type: "text" as const, text: results.join("\n") }],
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
