import { describe, expect, test } from "bun:test"
import { createPreflightGate } from "./gate"
import type { ProbeResult } from "./types"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

async function fixtureBinary(contents: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "kanna-gate-bin-"))
  const f = path.join(dir, "claude")
  await writeFile(f, contents, "utf8")
  return { filePath: f, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

const PASS_PROBES: ProbeResult[] = [{ kind: "pass", builtin: "Bash", evidence: "no_builtin_tool_use_in_assistant_turn" }]
const FAIL_PROBES: ProbeResult[] = [{ kind: "fail", builtin: "Bash", evidence: "tool_use:Bash" }]

describe("preflight gate", () => {
  test("concurrent canSpawn calls share a single suite run", async () => {
    const { filePath, cleanup } = await fixtureBinary("v5")
    try {
      let suiteCalls = 0
      let resolveSuite: ((probes: ProbeResult[]) => void) | undefined
      const gate = createPreflightGate({
        toolsString: "mcp__kanna__*",
        now: () => 0,
        runSuite: () => {
          suiteCalls++
          return new Promise<ProbeResult[]>((r) => { resolveSuite = r })
        },
      })
      const p1 = gate.canSpawn({ binaryPath: filePath, model: "m" })
      const p2 = gate.canSpawn({ binaryPath: filePath, model: "m" })
      await new Promise((r) => setTimeout(r, 10))
      if (resolveSuite) (resolveSuite as (probes: ProbeResult[]) => void)(PASS_PROBES)
      await p1; await p2
      expect(suiteCalls).toBe(1)
    } finally { await cleanup() }
  })

  test("cache miss + suite passes → ok and caches", async () => {
    const { filePath, cleanup } = await fixtureBinary("v1")
    try {
      let suiteCalls = 0
      const gate = createPreflightGate({
        toolsString: "mcp__kanna__*",
        now: () => 0,
        runSuite: async () => { suiteCalls++; return PASS_PROBES },
      })
      const r1 = await gate.canSpawn({ binaryPath: filePath, model: "m" })
      expect(r1.ok).toBe(true)
      // Second call should hit cache.
      await gate.canSpawn({ binaryPath: filePath, model: "m" })
      expect(suiteCalls).toBe(1)
    } finally { await cleanup() }
  })

  test("suite fails → not ok with reason", async () => {
    const { filePath, cleanup } = await fixtureBinary("v2")
    try {
      const gate = createPreflightGate({
        toolsString: "mcp__kanna__*",
        now: () => 0,
        runSuite: async () => FAIL_PROBES,
      })
      const r = await gate.canSpawn({ binaryPath: filePath, model: "m" })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain("Bash")
    } finally { await cleanup() }
  })

  test("changing binary sha256 invalidates cache", async () => {
    const { filePath: a, cleanup: cA } = await fixtureBinary("v3")
    const { filePath: b, cleanup: cB } = await fixtureBinary("v4")
    try {
      let suiteCalls = 0
      const gate = createPreflightGate({
        toolsString: "mcp__kanna__*",
        now: () => 0,
        runSuite: async () => { suiteCalls++; return PASS_PROBES },
      })
      await gate.canSpawn({ binaryPath: a, model: "m" })
      await gate.canSpawn({ binaryPath: b, model: "m" })
      expect(suiteCalls).toBe(2)
    } finally { await cA(); await cB() }
  })
})
