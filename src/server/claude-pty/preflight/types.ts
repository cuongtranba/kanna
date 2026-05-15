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

export interface AllowlistCacheKey {
  binarySha256: string
  toolsString: string
  systemInitModel: string
}

export interface SuiteResult {
  key: AllowlistCacheKey
  verdict: "pass" | "fail" | "indeterminate"
  probes: ProbeResult[]
  probedAt: number
}
