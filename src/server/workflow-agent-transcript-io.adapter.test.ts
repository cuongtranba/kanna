import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readWorkflowAgentTranscriptLines } from "./workflow-agent-transcript-io.adapter"

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "wf-agent-io-")); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

// Build a session layout: <root>/workflows (the registered sidecar dir) +
// <root>/subagents/workflows/<runId>/agent-<id>.jsonl (the live transcript).
function session(runId: string, agentId: string, body: string): string {
  const root = tmp()
  const workflowsDir = join(root, "workflows")
  mkdirSync(workflowsDir, { recursive: true })
  const runDir = join(root, "subagents", "workflows", runId)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, `agent-${agentId}.jsonl`), body)
  return workflowsDir
}

describe("workflow-agent-transcript-io.adapter", () => {
  test("reads non-blank lines of the run's agent-<id>.jsonl", () => {
    const dir = session("wf_1", "a1", '{"type":"user"}\n\n{"type":"assistant"}\n')
    expect(readWorkflowAgentTranscriptLines(dir, "wf_1", "a1")).toEqual([
      '{"type":"user"}',
      '{"type":"assistant"}',
    ])
  })

  test("accepts an agentId already carrying the agent- prefix", () => {
    const dir = session("wf_1", "xyz", '{"type":"user"}\n')
    expect(readWorkflowAgentTranscriptLines(dir, "wf_1", "agent-xyz")).toEqual(['{"type":"user"}'])
  })

  test("returns [] for a missing agent file", () => {
    const dir = session("wf_1", "a1", '{"type":"user"}\n')
    expect(readWorkflowAgentTranscriptLines(dir, "wf_1", "nope")).toEqual([])
  })

  test("returns [] for an unknown run dir", () => {
    const dir = session("wf_1", "a1", '{"type":"user"}\n')
    expect(readWorkflowAgentTranscriptLines(dir, "wf_other", "a1")).toEqual([])
  })

  test("returns [] when the session dir does not exist", () => {
    expect(readWorkflowAgentTranscriptLines(join(tmp(), "workflows"), "wf_1", "a1")).toEqual([])
  })
})
