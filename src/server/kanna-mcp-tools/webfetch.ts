import { z } from "zod"
import { errorMessage } from "../../shared/errors"
import { fail, ok } from "../kanna-mcp-tool"
import type { ToolCallbackService } from "../tool-callback"
import { defineGatedTool } from "./tool-callback-shim"

const SHAPE = {
  url: z.string(),
}

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

export function createWebFetchTool(deps: { toolCallback: ToolCallbackService }) {
  return defineGatedTool(deps, {
    name: "webfetch",
    shape: SHAPE,
    async run(input) {
      const check = isSafeUrl(input.url)
      if (!check.ok) return fail(`Error: ${check.reason}`)
      try {
        const res = await fetch(input.url)
        const text = await res.text()
        return ok(`Status: ${res.status}\n\n${text}`)
      } catch (err) {
        return fail(`Error fetching URL: ${errorMessage(err)}`)
      }
    },
  })
}
