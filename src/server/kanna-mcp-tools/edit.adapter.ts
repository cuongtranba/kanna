import { z } from "zod"
import { readFile, writeFile } from "node:fs/promises"
import { errorMessage } from "../../shared/errors"
import { currentHomeDir } from "../home-dir.adapter"
import { resolveUserPath } from "../home-path"
import { fail, ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"

const SHAPE = {
  path: z.string(),
  oldString: z.string(),
  newString: z.string(),
}

export function createEditTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "edit",
    shape: SHAPE,
    async run(input, ctx) {
      const resolved = resolveUserPath(input.path, ctx.cwd, currentHomeDir())
      let content: string
      try {
        content = await readFile(resolved, "utf8")
      } catch (err) {
        return fail(`Error reading file: ${errorMessage(err)}`)
      }

      let count = 0
      let idx = 0
      while ((idx = content.indexOf(input.oldString, idx)) !== -1) {
        count++
        idx += input.oldString.length
      }

      if (count === 0) return fail("Error: oldString not found in file")
      if (count > 1) return fail(`Error: oldString is ambiguous — found ${count} occurrences`)

      try {
        await writeFile(resolved, content.split(input.oldString).join(input.newString), "utf8")
      } catch (err) {
        return fail(`Error writing file: ${errorMessage(err)}`)
      }
      return ok("Edit applied successfully")
    },
  })
}
