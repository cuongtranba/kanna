import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk"
import type { Subagent } from "../../shared/types"

export function sanitizeAgentKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

export function buildAgentDefinitions(subagents: readonly Subagent[]): Record<string, AgentDefinition> {
  const defs: Record<string, AgentDefinition> = {}
  const claudeSubs = subagents
    .filter((s) => s.provider === "claude")
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const s of claudeSubs) {
    const key = sanitizeAgentKey(s.name)
    if (!key) continue
    defs[key] = {
      description: s.description?.trim() ? s.description : s.name,
      prompt: s.systemPrompt,
      model: s.model,
    }
  }
  return defs
}
