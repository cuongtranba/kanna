export interface ClaudeApiErrorDescription {
  headline: string
  explanation: string
  remedy: string
}

const DESCRIPTION_BY_REASON: ReadonlyMap<string, ClaudeApiErrorDescription> = new Map([
  ["claude_code_version_too_old", {
    headline: "Model not supported by this Claude Code version",
    explanation: "The selected model needs a newer Claude Code than the one Kanna runs, so every turn on this model fails.",
    remedy: "Pick another model, or update Kanna, which bundles Claude Code. If Kanna runs your own claude binary (the PTY driver, or CLAUDE_EXECUTABLE is set), run \"claude update\" instead.",
  }],
])

export function describeClaudeApiError(reason: string | undefined): ClaudeApiErrorDescription | null {
  if (reason === undefined) return null
  return DESCRIPTION_BY_REASON.get(reason) ?? null
}

export function claudeApiErrorLinksStatusPage(status: number): boolean {
  return status === 429 || status >= 500
}
