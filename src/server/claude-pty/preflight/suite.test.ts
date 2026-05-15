import { describe, expect, test } from "bun:test"
import { aggregateProbes } from "./suite"
import type { ProbeResult } from "./types"

describe("aggregateProbes", () => {
  test("all pass → pass", () => {
    const probes: ProbeResult[] = [
      { kind: "pass", builtin: "Bash", evidence: "probe_unavailable" },
      { kind: "pass", builtin: "Read", evidence: "probe_unavailable" },
    ]
    expect(aggregateProbes(probes).verdict).toBe("pass")
  })

  test("any fail → fail", () => {
    const probes: ProbeResult[] = [
      { kind: "pass", builtin: "Bash", evidence: "probe_unavailable" },
      { kind: "fail", builtin: "Read", evidence: "tool_use:Read" },
    ]
    expect(aggregateProbes(probes).verdict).toBe("fail")
  })

  test("no fails but at least one indeterminate → indeterminate", () => {
    const probes: ProbeResult[] = [
      { kind: "pass", builtin: "Bash", evidence: "probe_unavailable" },
      { kind: "indeterminate", builtin: "Read", reason: "timeout" },
    ]
    expect(aggregateProbes(probes).verdict).toBe("indeterminate")
  })
})
