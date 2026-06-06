import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { MemoryLoadedMessage } from "./MemoryLoadedMessage"
import type { ProcessedMemoryLoadedMessage } from "./types"

function buildMessage(overrides: Partial<ProcessedMemoryLoadedMessage> = {}): ProcessedMemoryLoadedMessage {
  return {
    kind: "memory_loaded",
    path: "/repo/.claude/rules/pattern_id.md",
    id: "mem-1",
    timestamp: "2026-06-06T00:00:00Z",
    ...overrides,
  }
}

describe("MemoryLoadedMessage", () => {
  test("renders the Loaded label and the file basename", () => {
    const html = renderToStaticMarkup(<MemoryLoadedMessage message={buildMessage()} />)
    expect(html).toContain("Loaded")
    expect(html).toContain("pattern_id.md")
  })

  test("shows the parent directory of an absolute path", () => {
    const html = renderToStaticMarkup(<MemoryLoadedMessage message={buildMessage()} />)
    expect(html).toContain("/repo/.claude/rules/")
  })

  test("renders a bare filename without a directory segment", () => {
    const html = renderToStaticMarkup(<MemoryLoadedMessage message={buildMessage({ path: "CLAUDE.md" })} />)
    expect(html).toContain("CLAUDE.md")
  })
})
