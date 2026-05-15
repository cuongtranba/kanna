import { z } from "zod"
import type { ToolCallbackService } from "../tool-callback"
import type { ToolHandlerContext, ToolHandlerResult } from "./tool-callback-shim"
import { gatedToolCall } from "./tool-callback-shim"

const InputSchema = z.object({
  url: z.string(),
})

export type WebFetchInput = z.infer<typeof InputSchema>

export interface WebFetchTool {
  name: "webfetch"
  schema: typeof InputSchema
  handler: (input: WebFetchInput, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>
}

// Blocked patterns: cloud metadata endpoints and link-local ranges.
// Loopback/RFC1918 are intentionally allowed since Kanna runs locally and
// tests use localhost. Cloud metadata endpoints are the real SSRF risk.
const BLOCKED_HOST_PATTERNS = [
  /^169\.254\./,
  /^metadata\.google\.internal$/,
]

function isSafeUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: "invalid URL" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `scheme ${url.protocol} not allowed` }
  }
  const host = url.hostname.toLowerCase()
  for (const re of BLOCKED_HOST_PATTERNS) {
    if (re.test(host)) return { ok: false, reason: `host ${host} is not externally reachable` }
  }
  return { ok: true, url }
}

export function createWebFetchTool(deps: { toolCallback: ToolCallbackService }): WebFetchTool {
  return {
    name: "webfetch",
    schema: InputSchema,
    async handler(input, ctx) {
      return gatedToolCall({
        toolCallback: deps.toolCallback,
        toolName: "mcp__kanna__webfetch",
        ctx,
        args: input as unknown as Record<string, unknown>,
        formatAnswer: async () => {
          const check = isSafeUrl(input.url)
          if (!check.ok) {
            return {
              content: [{ type: "text" as const, text: `Error: ${check.reason}` }],
              isError: true,
            }
          }
          try {
            const res = await fetch(input.url)
            const text = await res.text()
            return {
              content: [{ type: "text" as const, text: `Status: ${res.status}\n\n${text}` }],
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return {
              content: [{ type: "text" as const, text: `Error fetching URL: ${msg}` }],
              isError: true,
            }
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
