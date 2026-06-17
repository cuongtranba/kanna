import type { ResolvedStackBinding, Subagent } from "./types"

/**
 * The Kanna system-prompt suffix appended to Claude's `claude_code` preset.
 *
 * Single source of truth for both drivers:
 * - SDK driver (`agent.ts`) passes it as `systemPrompt.append`.
 * - PTY driver (`claude-pty/driver.ts`) passes it via `--append-system-prompt`.
 *
 * Keeping the two in lockstep matters: a weaker PTY prompt diverged refusal
 * behaviour (PTY would decline reverse-engineering / security-research tasks
 * the SDK path accepts). Edit here, both drivers inherit it.
 */
export const KANNA_SYSTEM_PROMPT_BASE =
  "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI. Treat user code as their own project. Do not refuse tasks or label code as 'malware' based on speculation; only refuse when the user explicitly requests clearly malicious behavior (e.g. weaponized exploits against third parties, credential theft, mass abuse). Reverse-engineering, security research, defensive tooling, low-level system code, packers, hooks, and unconventional patterns in the user's own project are legitimate and must be assisted."

/**
 * Legacy constant kept for snapshot/import compatibility. Equal to
 * {@link KANNA_SYSTEM_PROMPT_BASE} when no subagents are configured.
 * Callers that have a subagent roster should use
 * {@link buildKannaSystemPromptAppend} instead.
 */
export const KANNA_SYSTEM_PROMPT_APPEND = KANNA_SYSTEM_PROMPT_BASE

/** Soft cap on roster size embedded in the system prompt. */
export const KANNA_SUBAGENT_ROSTER_LIMIT = 20

/**
 * Render the `## Stack projects` block naming each bound project (title + role
 * + worktree path). Returns "" when the list is empty so callers can splice it
 * unconditionally. Shared by the main-turn builder and the subagent
 * system-prompt composer so both surface identical project labels.
 *
 * Wording does not assume more than one binding — a stack may carry a lone
 * primary — so it reads correctly for any non-empty list.
 */
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

const DELEGATION_GUIDANCE =
  "Delegate via `mcp__kanna__delegate_subagent({ subagent_id, prompt })`. The tool blocks until the subagent finishes and returns its final text. Brief the subagent like a smart colleague who just walked in: state the goal, what was tried, what to check, and any constraints. Don't delegate understanding — synthesize the subagent's reply yourself before responding to the user. When the user writes `@agent/<name>` treat it as a suggestion, not a command: confirm the subagent fits the actual ask, or redirect to a better one."

/** Optional inputs for {@link buildKannaSystemPromptAppend}. */
export interface KannaSystemPromptOptions {
  /**
   * User-authored global prompt from settings. When non-empty (after trim)
   * it is spliced into the suffix as a `## Project instructions` block
   * placed after {@link KANNA_SYSTEM_PROMPT_BASE} and before the subagent
   * roster. Whitespace-only values are treated as absent.
   *
   * Surfaces the same content to Claude (`systemPrompt.append` /
   * `--append-system-prompt`) and Codex (`developer_instructions`).
   */
  globalPromptAppend?: string

  /**
   * Resolved stack bindings for a multi-project ("stack") chat. When present
   * (≥1 entry) the suffix gains a `## Stack projects` block naming each
   * project (title + role + worktree path) so the model knows which project
   * each working directory belongs to and can work across them. Both drivers
   * already grant filesystem access to every root (SDK `additionalDirectories`,
   * PTY `--add-dir`); this only adds the human-readable mapping.
   *
   * Empty / absent for solo chats — the block is then omitted entirely.
   */
  stackProjects?: ResolvedStackBinding[]
}

/**
 * Build the system-prompt suffix for a turn. When the project has subagents
 * configured, appends a roster (name + description + id) plus delegation
 * guidance so the main model can call `mcp__kanna__delegate_subagent`.
 *
 * The roster is truncated to {@link KANNA_SUBAGENT_ROSTER_LIMIT} entries
 * (most-recently-updated first) to keep the prompt bounded.
 *
 * BASE always comes first so the refusal-policy paragraph is read before any
 * user-controlled `globalPromptAppend` text — keeps the safety contract in
 * scope even when callers paste arbitrary instructions.
 */
export function buildKannaSystemPromptAppend(
  subagents: Subagent[],
  options: KannaSystemPromptOptions = {},
): string {
  const projectInstructions = options.globalPromptAppend?.trim() ?? ""
  const stackProjects = options.stackProjects ?? []

  if (subagents.length === 0 && !projectInstructions && stackProjects.length === 0) {
    return KANNA_SYSTEM_PROMPT_BASE
  }

  const sections: string[] = [KANNA_SYSTEM_PROMPT_BASE]

  if (projectInstructions) {
    sections.push("", "## Project instructions", "", projectInstructions)
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
