import { expect, test } from "vite-plus/test"
import type { McpSourceState } from "../../shared/mcp-sources/types"
import { mcpSourceStateLabel, mcpSourceStateTone } from "./mcpSourcePresentation"

test("every source state reads as a distinct word and failures are never muted", () => {
  const states: McpSourceState[] = ["disabled", "connecting", "listening", "polling", "backoff", "error"]
  expect(new Set(states.map(mcpSourceStateLabel)).size).toBe(states.length)
  expect(mcpSourceStateTone("error")).toBe("destructive")
  expect(mcpSourceStateTone("backoff")).toBe("attention")
  expect(mcpSourceStateTone("disabled")).toBe("muted")
})
