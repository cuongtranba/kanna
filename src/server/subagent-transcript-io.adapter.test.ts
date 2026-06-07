import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readAgentTranscriptLines } from "./subagent-transcript-io.adapter"

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "sa-io-")); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe("subagent-transcript-io.adapter", () => {
  test("reads non-blank lines of agent-<id>.jsonl", () => {
    const d = tmp()
    writeFileSync(join(d, "agent-abc.jsonl"), '{"type":"user"}\n\n{"type":"assistant"}\n')
    expect(readAgentTranscriptLines(d, "abc")).toEqual(['{"type":"user"}', '{"type":"assistant"}'])
  })

  test("accepts an agentId already carrying the agent- prefix", () => {
    const d = tmp()
    writeFileSync(join(d, "agent-xyz.jsonl"), '{"type":"user"}\n')
    expect(readAgentTranscriptLines(d, "agent-xyz")).toEqual(['{"type":"user"}'])
  })

  test("returns [] for a missing file", () => {
    expect(readAgentTranscriptLines(tmp(), "nope")).toEqual([])
  })

  test("returns [] when the dir does not exist", () => {
    expect(readAgentTranscriptLines(join(tmp(), "subagents"), "x")).toEqual([])
  })
})
