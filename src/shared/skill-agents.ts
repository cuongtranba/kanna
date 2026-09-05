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

export const DEFAULT_SKILL_AGENTS: readonly SkillAgent[] = ["universal", "claude-code", "codex"]

const VALID_SKILL_AGENT_LOOKUP: ReadonlySet<string> = new Set(VALID_SKILL_AGENTS)

function isSkillAgent(value: string): value is SkillAgent {
  return VALID_SKILL_AGENT_LOOKUP.has(value)
}

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
