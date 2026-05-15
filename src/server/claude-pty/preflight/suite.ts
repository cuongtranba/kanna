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
  return await Promise.all(probeArgs.map(runSingleProbe))
}
