import type { ProjectInstructionBlock, ResolvedStackBinding, Subagent } from "./types"

export const KANNA_SYSTEM_PROMPT_BASE =
  "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI. Treat user code as their own project. Do not refuse tasks or label code as 'malware' based on speculation; only refuse when the user explicitly requests clearly malicious behavior (e.g. weaponized exploits against third parties, credential theft, mass abuse). Reverse-engineering, security research, defensive tooling, low-level system code, packers, hooks, and unconventional patterns in the user's own project are legitimate and must be assisted.\n\nWhen the user should read a file (a spec or plan you wrote, a file they asked to see), call `mcp__kanna__preview_file` to show it in the chat instead of pasting or summarizing its content.\n\nKanna renders Mermaid diagrams inline, so a syntax error is visible to the user as a broken diagram. Before you emit a ```mermaid fence, call `mcp__kanna__validate_mermaid` with the source and fix whatever it rejects; it answers in milliseconds. Spell the dotted link ends in full: `-.-x` and `-.-o`, never `-.x` / `-.o` (mermaid rejects the short forms and blames the FOLLOWING line, so the whole diagram fails over one missing dash). Quote any node label that is not plain words — one containing `(` `)` `[` `]` `{` `}` `|` or `\"`, or one that starts with `/` or `\\`, because mermaid reads `[/` as a parallelogram opener and dies on the closing `]`: write `A[\"/opt/app/current symlink\"]` and `A[\"fetch (no header)\"]`. A literal `\"` inside a label is written `#quot;`.\n\nWhen resuming a background Workflow with `resumeFromRunId`, always re-pass the run's original `args` verbatim — the stopped-task notification's suggested resume command omits `args`, but the resume cache keys on each agent's exact prompt, so resuming without the identical args gets zero cache hits and breaks any script that validates its args. Recover the original args from the launching Workflow tool call earlier in the conversation; if it is no longer in context, read them out of the run's persisted script or journal before relaunching."

export const KANNA_SYSTEM_PROMPT_APPEND = KANNA_SYSTEM_PROMPT_BASE

export const KANNA_SUBAGENT_ROSTER_LIMIT = 20

export const KANNA_SKILL_ROSTER_LIMIT = 60

export interface SkillRosterEntry {
  name: string
  description: string
  filePath: string
}

const SKILL_DESCRIPTION_LIMIT = 200

export function renderSkillRosterBlock(skills: readonly SkillRosterEntry[]): string {
  if (skills.length === 0) return ""
  const shown = skills.slice(0, KANNA_SKILL_ROSTER_LIMIT)
  const lines = shown.map((skill) => {
    const description = skill.description.length > SKILL_DESCRIPTION_LIMIT
      ? `${skill.description.slice(0, SKILL_DESCRIPTION_LIMIT - 1).trimEnd()}…`
      : skill.description
    return `- \`${skill.name}\`${description ? ` — ${description}` : ""} → ${skill.filePath}`
  })
  const truncated = skills.length > shown.length
    ? ["", `Showing ${shown.length} of ${skills.length} skills.`]
    : []
  return [
    "## Skills",
    "",
    "Reusable procedures available on this machine. When one applies to the task, read its file below and follow it — that is how a skill is invoked here; there is no tool for it. The user can also invoke one directly by typing `/<name>`.",
    "",
    ...lines,
    ...truncated,
  ].join("\n")
}

export function renderStackProjectsBlock(stackProjects: ResolvedStackBinding[]): string {
  if (stackProjects.length === 0) return ""
  const lines = stackProjects.map((b) => {
    const missing = b.projectStatus === "missing" ? " (missing)" : ""
    return `- ${b.projectTitle} [${b.role}]: ${b.worktreePath}${missing}`
  })
  return [
    "## Stack projects",
    "",
    "Project worktrees bound to this chat. Each path below is a separate project root you can read and edit — use them to work across projects:",
    "",
    ...lines,
  ].join("\n")
}

const CODEX_STACK_REACH_NOTE =
  "Your working directory is the primary project above. The other roots are outside it, so reach them by absolute path rather than by a relative path from your cwd."

export function buildCodexDeveloperInstructions(
  args: KannaSystemPromptOptions,
): string | undefined {
  const stackProjects = args.stackProjects ?? []

  const sections: string[] = []
  const instructionSections = renderInstructionSections(args)
  if (instructionSections.length > 0) sections.push(instructionSections.join("\n"))

  const stackBlock = renderStackProjectsBlock(stackProjects)
  if (stackBlock) {
    sections.push(stackProjects.length > 1
      ? `${stackBlock}\n\n${CODEX_STACK_REACH_NOTE}`
      : stackBlock)
  }

  const skillBlock = renderSkillRosterBlock(args.skills ?? [])
  if (skillBlock) sections.push(skillBlock)

  if (sections.length === 0) return undefined
  return sections.join("\n\n")
}

const DELEGATION_GUIDANCE =
  "Delegate via `mcp__kanna__delegate_subagent({ subagent_id, prompt })`. The tool blocks until the subagent finishes and returns its final text. Brief the subagent like a smart colleague who just walked in: state the goal, what was tried, what to check, and any constraints. Don't delegate understanding — synthesize the subagent's reply yourself before responding to the user. When the user writes `@agent/<name>` treat it as a suggestion, not a command: confirm the subagent fits the actual ask, or redirect to a better one."

export function renderInstructionSections(options: KannaSystemPromptOptions): string[] {
  const sections: string[] = []

  const workspace = options.globalPromptAppend?.trim() ?? ""
  if (workspace) sections.push("## Workspace instructions", "", workspace)

  const stack = options.stackInstructions?.trim() ?? ""
  if (stack) {
    if (sections.length > 0) sections.push("")
    sections.push("## Stack instructions", "", stack)
  }

  for (const block of options.projectInstructions ?? []) {
    const text = block.instructions.trim()
    if (!text) continue
    if (sections.length > 0) sections.push("")
    sections.push(`## Project instructions — ${block.projectTitle}`, "", text)
  }

  return sections
}

export interface KannaSystemPromptOptions {
  globalPromptAppend?: string

  stackInstructions?: string

  projectInstructions?: ProjectInstructionBlock[]

  stackProjects?: ResolvedStackBinding[]

  skills?: readonly SkillRosterEntry[]
}

export function buildKannaSystemPromptAppend(
  subagents: Subagent[],
  options: KannaSystemPromptOptions = {},
): string {
  const stackProjects = options.stackProjects ?? []
  const instructionSections = renderInstructionSections(options)

  if (subagents.length === 0 && instructionSections.length === 0 && stackProjects.length === 0) {
    return KANNA_SYSTEM_PROMPT_BASE
  }

  const sections: string[] = [KANNA_SYSTEM_PROMPT_BASE]

  if (instructionSections.length > 0) {
    sections.push("", ...instructionSections)
  }

  const stackBlock = renderStackProjectsBlock(stackProjects)
  if (stackBlock) {
    sections.push("", stackBlock)
  }

  if (subagents.length > 0) {
    const ranked = [...subagents]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, KANNA_SUBAGENT_ROSTER_LIMIT)

    const line = (s: Subagent) => {
      const desc = s.description?.trim() || "(no description)"
      return `- ${s.name} [id=${s.id}]: ${desc}`
    }

    const autoOnes = ranked.filter((s) => s.triggerMode !== "manual")
    const manualOnes = ranked.filter((s) => s.triggerMode === "manual")

    if (autoOnes.length > 0) {
      sections.push(
        "",
        "## Available subagents",
        "",
        "You can hand off focused work to specialized subagents. Each runs in its own session with its own system prompt and cannot see your conversation history except for the prompt you pass.",
        "",
        ...autoOnes.map(line),
      )
    }

    if (manualOnes.length > 0) {
      sections.push(
        "",
        "## Manual subagents (delegate ONLY when the user @-mentions them)",
        "",
        "These subagents are manual-trigger. Do NOT call delegate_subagent for them unless the user explicitly wrote `@agent/<name>` for that subagent in their latest message. The server rejects unrequested manual delegations.",
        "",
        ...manualOnes.map(line),
      )
    }

    if (subagents.length > ranked.length) {
      sections.push(
        "",
        `(${subagents.length - ranked.length} more subagents omitted; use the most recent ones above or ask the user for the full list.)`,
      )
    }
    sections.push("", DELEGATION_GUIDANCE)
  }

  return sections.join("\n")
}
