import { z } from "zod"
import { fail } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"

const SHAPE = {
  query: z.string(),
}

export function createWebSearchTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "websearch",
    shape: SHAPE,
    async run() {
      return fail(
        "WebSearch unavailable in this environment. Use mcp__kanna__webfetch with a specific URL if you already know the target.",
      )
    },
  })
}
