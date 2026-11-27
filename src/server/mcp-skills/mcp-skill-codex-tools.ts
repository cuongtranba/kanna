import { z } from "zod"
import { renderJsonSchema } from "../../shared/commands"
import type { JsonValue } from "../../shared/json"
import {
  READ_RESOURCE_DESCRIPTION,
  READ_RESOURCE_TOOL,
  READ_SKILL_DESCRIPTION,
  READ_SKILL_TOOL,
  readResourceInputSchema,
  readSkillInputSchema,
} from "../../shared/mcp-skills/tool-specs"
import type { DynamicToolSpec } from "../codex-app-server-protocol"
import type { KannaToolOutcome } from "../codex-dynamic-tool-call"
import type { McpSkillTools } from "../kanna-mcp-skills"
import type { McpSkillOutcome } from "./mcp-skill-host"

export const MCP_SKILL_TOOL_SPECS: readonly DynamicToolSpec[] = [
  { type: "function", name: READ_SKILL_TOOL, description: READ_SKILL_DESCRIPTION, inputSchema: renderJsonSchema(readSkillInputSchema, "input") },
  { type: "function", name: READ_RESOURCE_TOOL, description: READ_RESOURCE_DESCRIPTION, inputSchema: renderJsonSchema(readResourceInputSchema, "input") },
]

function toOutcome(outcome: McpSkillOutcome): KannaToolOutcome {
  return outcome.ok ? { text: outcome.text, isError: false } : { text: outcome.error, isError: true }
}

export async function callMcpSkillTool(skills: McpSkillTools, tool: string, args: JsonValue): Promise<KannaToolOutcome | null> {
  if (tool !== READ_SKILL_TOOL && tool !== READ_RESOURCE_TOOL) return null
  const parsed = (tool === READ_SKILL_TOOL ? readSkillInputSchema : readResourceInputSchema).safeParse(args)
  if (!parsed.success) return { text: `Invalid arguments: ${z.prettifyError(parsed.error)}`, isError: true }
  const { server, uri } = parsed.data
  return toOutcome(tool === READ_SKILL_TOOL ? await skills.loadSkill(server, uri) : await skills.readResource(server, uri))
}
