import { z } from "zod"
import { readFile } from "node:fs/promises"
import { errorMessage } from "../../shared/errors"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import { fail, ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"

const SHAPE = {
  path: z.string(),
}

export function createReadTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "read",
    shape: SHAPE,
    async run(input, ctx) {
      try {
        return ok(await readFile(resolveUserPath(input.path, ctx.cwd, currentHomeDir()), "utf8"))
      } catch (err) {
        return fail(`Error reading file: ${errorMessage(err)}`)
      }
    },
  })
}
