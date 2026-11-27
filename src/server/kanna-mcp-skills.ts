import {
  READ_RESOURCE_DESCRIPTION,
  READ_RESOURCE_TOOL,
  READ_SKILL_DESCRIPTION,
  READ_SKILL_TOOL,
  readResourceInputShape,
  readSkillInputShape,
} from "../shared/mcp-skills/tool-specs"
import { fail, ok, type KannaToolFactory, type ToolResult } from "./kanna-mcp-tool"
import type { McpSkillHost, McpSkillOutcome } from "./mcp-skills/mcp-skill-host"

export type McpSkillTools = Pick<McpSkillHost, "loadSkill" | "readResource">

function toToolResult(outcome: McpSkillOutcome): ToolResult {
  return outcome.ok ? ok(outcome.text) : fail(outcome.error)
}

export function buildMcpSkillToolList<TTool>(skills: McpSkillTools | undefined, tool: KannaToolFactory<TTool>): TTool[] {
  if (!skills) return []
  return [
    tool(READ_SKILL_TOOL, READ_SKILL_DESCRIPTION, readSkillInputShape, async (input) =>
      toToolResult(await skills.loadSkill(input.server, input.uri)),
    ),
    tool(READ_RESOURCE_TOOL, READ_RESOURCE_DESCRIPTION, readResourceInputShape, async (input) =>
      toToolResult(await skills.readResource(input.server, input.uri)),
    ),
  ]
}
