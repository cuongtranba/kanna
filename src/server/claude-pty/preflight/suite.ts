import type { ProbeResult } from "./types"
import { DISALLOWED_BUILTINS, type DisallowedBuiltin } from "./types"
import { runSingleProbe, type RunSingleProbeArgs } from "./probe"

export function aggregateProbes(probes: ProbeResult[]): { verdict: "pass" | "fail" | "indeterminate" } {
  let hasFail = false
  let hasIndeterminate = false
  for (const p of probes) {
    if (p.kind === "fail") hasFail = true
    else if (p.kind === "indeterminate") hasIndeterminate = true
  }
  if (hasFail) return { verdict: "fail" }
  if (hasIndeterminate) return { verdict: "indeterminate" }
  return { verdict: "pass" }
}

export interface RunSuiteArgs {
  claudeBin: string
  model: string
  homeDir?: string
  timeoutMs?: number
}

export async function runFullSuite(args: RunSuiteArgs): Promise<ProbeResult[]> {
  const probeArgs: RunSingleProbeArgs[] = DISALLOWED_BUILTINS.map((builtin) => ({
    builtin: builtin as DisallowedBuiltin,
    claudeBin: args.claudeBin,
    model: args.model,
    homeDir: args.homeDir,
    timeoutMs: args.timeoutMs,
  }))
  // Sequential, not parallel: 8 concurrent spawns thrashed the OAuth pool
  // (each probe burns one turn) and overran the per-probe timeout because
  // SessionStart hook startup cost piled on top. Sequential keeps each
  // probe in a clean window; result still cached for 24 h after first run.
  const results: ProbeResult[] = []
  for (const probe of probeArgs) {
    results.push(await runSingleProbe(probe))
  }
  return results
}
