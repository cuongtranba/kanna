/**
 * Known agent aliases supported by the `skills` CLI.
 *
 * Sourced from `lastSelectedAgents` in `~/.agents/.skill-lock.json`
 * as of skills@1.5.23. These values become spawn arguments — only entries
 * in this list are accepted; anything else is rejected before a process is
 * ever forked.
 */
export const VALID_SKILL_AGENTS = [
  "amp",
  "antigravity",
  "antigravity-cli",
  "cline",
  "claude-code",
  "codex",
  "cursor",
  "deepagents",
  "gemini-cli",
  "github-copilot",
  "kimi-code-cli",
  "opencode",
  "universal",
  "warp",
  "zed",
] as const

export type SkillAgent = (typeof VALID_SKILL_AGENTS)[number]

/** Agents targeted by default when the user has not configured a custom list. */
export const DEFAULT_SKILL_AGENTS: readonly SkillAgent[] = ["universal", "claude-code", "codex"]

const VALID_SKILL_AGENT_LOOKUP: ReadonlySet<string> = new Set(VALID_SKILL_AGENTS)

function isSkillAgent(value: string): value is SkillAgent {
  return VALID_SKILL_AGENT_LOOKUP.has(value)
}

/**
 * Validates an array of agent alias strings against the known allowlist.
 * Rejects empty arrays, unknown aliases, and duplicates.
 * Returns the validated array typed as SkillAgent[].
 */
export function assertSafeSkillAgents(agents: string[]): SkillAgent[] {
  if (agents.length === 0) {
    throw new Error("Skill agent list must not be empty.")
  }
  const seen = new Set<string>()
  const result: SkillAgent[] = []
  for (const agent of agents) {
    if (seen.has(agent)) {
      throw new Error(`Duplicate skill agent alias: ${JSON.stringify(agent)}.`)
    }
    seen.add(agent)
    if (!isSkillAgent(agent)) {
      throw new Error(
        `Unknown skill agent alias: ${JSON.stringify(agent)}. Valid values: ${VALID_SKILL_AGENTS.join(", ")}.`,
      )
    }
    result.push(agent)
  }
  return result
}
