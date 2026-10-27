import { z } from "zod"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { errorMessage } from "../../shared/errors"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import { fail, ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"

const SHAPE = {
  path: z.string(),
  content: z.string(),
}

export function createWriteTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "write",
    shape: SHAPE,
    async run(input, ctx) {
      const resolved = resolveUserPath(input.path, ctx.cwd, currentHomeDir())
      try {
        await mkdir(path.dirname(resolved), { recursive: true })
        await writeFile(resolved, input.content, "utf8")
      } catch (err) {
        return fail(`Error writing file: ${errorMessage(err)}`)
      }
      return ok(`File written: ${resolved}`)
    },
  })
}
