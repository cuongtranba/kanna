import { z } from "zod"
import path from "node:path"
import { minimatch } from "minimatch"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import { ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"
import { walkFiles } from "./walk-files.adapter"

const SHAPE = {
  path: z.string(),
  pattern: z.string(),
}

const MAX_RESULTS = 1000

export function createGlobTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "glob",
    shape: SHAPE,
    async run(input, ctx) {
      const root = resolveUserPath(input.path, ctx.cwd, currentHomeDir())
      const allFiles: string[] = []
      for await (const file of walkFiles(root)) {
        allFiles.push(file)
        if (allFiles.length >= MAX_RESULTS) break
      }
      const matches = allFiles
        .map((file) => path.relative(root, file))
        .filter((rel) => minimatch(rel, input.pattern, { dot: true }))
      return ok(matches.join("\n"))
    },
  })
}
