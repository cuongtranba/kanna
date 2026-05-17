export const DISALLOWED_BUILTINS = [
  "Bash",
  "Edit",
  "Write",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
] as const

export type DisallowedBuiltin = typeof DISALLOWED_BUILTINS[number]

export type ProbeResult =
  | { kind: "pass"; builtin: DisallowedBuiltin; evidence: string }
  | { kind: "fail"; builtin: DisallowedBuiltin; evidence: string }
  | { kind: "indeterminate"; builtin: DisallowedBuiltin; reason: string }

/**
 * Bumped whenever the probe contract changes in a way that could flip a
 * cached verdict: the spawn flags in `runSingleProbe` (permission-mode,
 * --tools, --dangerously-skip-permissions), the adversarial system
 * prompt, or the JSONL classifier in `classifyProbeFromJsonlLines`. Part
 * of the cache key so a code change auto-invalidates every stale entry
 * instead of serving a 24h-TTL verdict produced by the old logic.
 */
export const PROBE_CONTRACT_VERSION = "v1"

export interface AllowlistCacheKey {
  binarySha256: string
  toolsString: string
  systemInitModel: string
  /** PROBE_CONTRACT_VERSION at probe time. */
  probeContractVersion: string
}

export interface SuiteResult {
  key: AllowlistCacheKey
  verdict: "pass" | "fail" | "indeterminate"
  probes: ProbeResult[]
  probedAt: number
}
