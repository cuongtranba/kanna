import { z } from "zod"
import { readFile, stat } from "node:fs/promises"
import { errorMessage } from "../../shared/errors"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import { fail, ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"
import { walkFiles } from "./walk-files.adapter"

const SHAPE = {
  path: z.string(),
  pattern: z.string(),
}

const MAX_LINES = 500
const MAX_FILE_SIZE = 1_000_000

async function readSearchableFile(filePath: string): Promise<string | null> {
  try {
    const fileStat = await stat(filePath)
    if (fileStat.size > MAX_FILE_SIZE) return null
    return await readFile(filePath, "utf8")
  } catch {
    return null
  }
}

async function grepDir(root: string, re: RegExp, results: string[]): Promise<void> {
  for await (const filePath of walkFiles(root)) {
    if (results.length >= MAX_LINES) return
    const content = await readSearchableFile(filePath)
    if (content === null) continue
    const lines = content.split("\n")
    for (let i = 0; i < lines.length && results.length < MAX_LINES; i++) {
      if (re.test(lines[i])) {
        results.push(`${filePath}:${i + 1}: ${lines[i]}`)
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

export function createGrepTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "grep",
    shape: SHAPE,
    async run(input, ctx) {
      let re: RegExp
      try {
        re = new RegExp(input.pattern)
      } catch (err) {
        return fail(`Invalid regex pattern: ${errorMessage(err)}`)
      }
      const root = resolveUserPath(input.path, ctx.cwd, currentHomeDir())
      const results: string[] = []
      try {
        await grepWithTimeout(root, re, results)
      } catch (err) {
        return fail(`grep error: ${errorMessage(err)}`)
      }
      return ok(results.join("\n"))
    },
  })
}
