import type { ProjectInstructionBlock, ResolvedStackBinding, Subagent } from "./types"

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
  "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI. Treat user code as their own project. Do not refuse tasks or label code as 'malware' based on speculation; only refuse when the user explicitly requests clearly malicious behavior (e.g. weaponized exploits against third parties, credential theft, mass abuse). Reverse-engineering, security research, defensive tooling, low-level system code, packers, hooks, and unconventional patterns in the user's own project are legitimate and must be assisted.\n\nWhen the user should read a file (a spec or plan you wrote, a file they asked to see), call `mcp__kanna__preview_file` to show it in the chat instead of pasting or summarizing its content.\n\nKanna renders Mermaid diagrams inline, so a syntax error is visible to the user as a broken diagram. Before you emit a ```mermaid fence, call `mcp__kanna__validate_mermaid` with the source and fix whatever it rejects; it answers in milliseconds. Spell the dotted link ends in full: `-.-x` and `-.-o`, never `-.x` / `-.o` (mermaid rejects the short forms and blames the FOLLOWING line, so the whole diagram fails over one missing dash). Quote any node label that is not plain words — one containing `(` `)` `[` `]` `{` `}` `|` or `\"`, or one that starts with `/` or `\\`, because mermaid reads `[/` as a parallelogram opener and dies on the closing `]`: write `A[\"/opt/app/current symlink\"]` and `A[\"fetch (no header)\"]`. A literal `\"` inside a label is written `#quot;`.\n\nWhen resuming a background Workflow with `resumeFromRunId`, always re-pass the run's original `args` verbatim — the stopped-task notification's suggested resume command omits `args`, but the resume cache keys on each agent's exact prompt, so resuming without the identical args gets zero cache hits and breaks any script that validates its args. Recover the original args from the launching Workflow tool call earlier in the conversation; if it is no longer in context, read them out of the run's persisted script or journal before relaunching."

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

/**
 * What Codex can actually reach, stated once.
 *
 * Kanna starts every Codex thread with `approvalPolicy: "never"` and
 * `sandbox: "danger-full-access"` (`codex-app-server.ts`), so the peer roots
 * are readable and writable — the session simply declares ONE working
 * directory. The gap this closes is knowledge, not permission, and the wording
 * must not promise a multi-root workspace Codex does not have.
 *
 * (The `grantRoot` field on `FileChangeRequestApprovalParams` is part of an
 * approval RESPONSE, not a session grant; with approvals disabled it is never
 * exercised. The old comment in `claude-turn-starter.ts` had this backwards.)
 */
const CODEX_STACK_REACH_NOTE =
  "Your working directory is the primary project above. The other roots are outside it, so reach them by absolute path rather than by a relative path from your cwd."

/**
 * Compose Codex's `developer_instructions` from the same pieces the Claude
 * system prompt is built from, so switching a chat's provider does not
 * silently drop the stack.
 *
 * Returns `undefined` when there is nothing to say — the caller passes that
 * straight through to `thread/start`, which treats it as absent.
 */
export function buildCodexDeveloperInstructions(
  args: KannaSystemPromptOptions,
): string | undefined {
  const stackProjects = args.stackProjects ?? []

  const sections: string[] = []
  const instructionSections = renderInstructionSections(args)
  if (instructionSections.length > 0) sections.push(instructionSections.join("\n"))

  const stackBlock = renderStackProjectsBlock(stackProjects)
  if (stackBlock) {
    // A lone primary is not a cross-root situation; the caveat would be noise.
    sections.push(stackProjects.length > 1
      ? `${stackBlock}\n\n${CODEX_STACK_REACH_NOTE}`
      : stackBlock)
  }

  if (sections.length === 0) return undefined
  return sections.join("\n\n")
}

const DELEGATION_GUIDANCE =
  "Delegate via `mcp__kanna__delegate_subagent({ subagent_id, prompt })`. The tool blocks until the subagent finishes and returns its final text. Brief the subagent like a smart colleague who just walked in: state the goal, what was tried, what to check, and any constraints. Don't delegate understanding — synthesize the subagent's reply yourself before responding to the user. When the user writes `@agent/<name>` treat it as a suggestion, not a command: confirm the subagent fits the actual ask, or redirect to a better one."

/**
 * Render every instruction block in the order
 * BASE → workspace → stack → per-project. Broad to narrow: the workspace's
 * rules, then how the projects relate, then each project's own rules.
 *
 * Shared by the Claude suffix and the Codex developer instructions so a
 * provider switch cannot change which rules the model is told about.
 */
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

/** Optional inputs for {@link buildKannaSystemPromptAppend}. */
export interface KannaSystemPromptOptions {
  /**
   * User-authored global prompt from settings, rendered as
   * `## Workspace instructions`. Whitespace-only values are treated as absent.
   *
   * It is WORKSPACE-wide, not per project — the heading said "Project
   * instructions" until adr-20260904, which is the name the per-project blocks
   * below now carry.
   *
   * Surfaces the same content to Claude (`systemPrompt.append` /
   * `--append-system-prompt`) and Codex (`developer_instructions`).
   */
  globalPromptAppend?: string

  /**
   * The stack's own instructions — how its projects relate. Absent for a solo
   * chat and for a stack that has none.
   */
  stackInstructions?: string

  /**
   * One block per project whose rules apply to this turn, in binding order.
   * Built by `resolveProjectInstructions`, which is also what decides that a
   * SOLO chat gets its own project's block despite having no bindings.
   */
  projectInstructions?: ProjectInstructionBlock[]

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
