/**
 * Loop-template renderer + validator (pure).
 *
 * Feeds `mcp__kanna__setup_loop`. Server owns the template so `/loop` setups
 * are deterministic — user prompt like "set up /loop and goal to do X" flows
 * through validation before the model can start looping. See
 * adr-20260711-setup-loop-template.
 *
 * NO IO. Path resolution is on absolute strings only; caller supplies both
 * `cwd` and any user-provided `trackingFile` and this module normalizes /
 * confines. File creation happens in `loop-template-io.adapter.ts`.
 */

import { confinePathToDir, shellCommandIsParseable } from "./input-validation"

const DEFAULT_TRACKING_FILE = "PROGRESS.md"

export interface LoopSetupInput {
  /** Human-readable goal. Kept short — the model doesn't need prose here. */
  goal: string
  /** Verify command run in the project cwd. Exit code 0 = goal met. */
  verifyCommand: string
  /** Optional path (relative to cwd or absolute-inside-cwd). Default PROGRESS.md at cwd root. */
  trackingFile?: string
  /** Optional starter description of the first chunk written into the skeleton. */
  chunkHint?: string
  /**
   * Subagent the loop delegates each chunk to. Optional: when omitted the
   * caller's configured `defaultLoopSubagentId` is used. Resolution + roster
   * membership are validated so the loop never guesses at runtime.
   */
  subagentId?: string
}

/**
 * Loop-setup context the caller supplies: the current subagent roster (id →
 * display name) and the configured default loop subagent. Kept separate from
 * `LoopSetupInput` because it is server state, not model-supplied args.
 */
export interface LoopSetupContext {
  roster: readonly { id: string; name: string }[]
  defaultLoopSubagentId: string | null
}

export interface ResolvedLoopSetup {
  goal: string
  verifyCommand: string
  /** Absolute path inside `cwd`. */
  trackingFileAbs: string
  /** Path relative to `cwd`; the prompt embeds this. */
  trackingFileRel: string
  chunkHint: string | null
  /** Concrete subagent id the loop delegates to (never null after resolve). */
  subagentId: string
  /** The full recurring prompt the main agent will re-execute each iteration. */
  prompt: string
  /** Skeleton written when `trackingFileAbs` does not exist yet. */
  skeleton: string
}

export type LoopSetupValidation =
  | { ok: true; resolved: ResolvedLoopSetup }
  | { ok: false; errors: string[] }

function isNonBlankString<T>(v: T): v is T & string {
  return typeof v === "string" && v.trim().length > 0
}

/** Resolve a user-supplied tracking-file path against `cwd`; reject escapes. */
function resolveTrackingFile(
  input: string | undefined,
  cwd: string,
): { abs: string; rel: string } | { error: string } {
  return confinePathToDir(input ?? DEFAULT_TRACKING_FILE, cwd, "trackingFile")
}

/** Deterministic prompt for the main agent, replayed each loop iteration. */
function renderLoopPrompt(args: {
  goal: string
  verifyCommand: string
  trackingFileRel: string
  subagentId: string
}): string {
  const { goal, verifyCommand, trackingFileRel, subagentId } = args
  return [
    "You are the ORCHESTRATOR of an autonomous loop. You do NOT do the work",
    "yourself — you delegate it. Follow these steps EXACTLY every turn:",
    "",
    `1. Read the current plan by SECTION — do NOT read the whole ${trackingFileRel}.`,
    `   Call mcp__kanna__query_tracking_file({ sections: ["Next chunk", "Progress"], list_limit: 5 })`,
    `   (defaults to ${trackingFileRel}). This keeps the file off your context as it grows.`,
    `2. Run the verify command with Bash: \`${verifyCommand}\`. Check its exit code.`,
    "3. If the verify command exited 0, the goal is met. Print a one-line",
    `   "GOAL MET: ${goal}" message, then call mcp__kanna__stop_loop({}) and`,
    "   END THIS TURN. Do NOT call delegate_subagent.",
    "4. Otherwise, take the \"Next chunk\" from step 1 and delegate it",
    "   with EXACTLY this call (the subagent is fixed by configuration):",
    "",
    "     mcp__kanna__delegate_subagent({",
    `       subagent_id: "${subagentId}",`,
    "       run_in_background: true,",
    `       prompt: "Do the next chunk in ${trackingFileRel}. To read the plan, call mcp__kanna__query_tracking_file (by section — never read the whole file). Verify locally with \`${verifyCommand}\`. On success: call mcp__kanna__append_tracking_row({ section: \\"Progress\\", entry: \\"- <date> <chunk> DONE\\", position: \\"top\\" }) and append the next chunk under \\"Next chunk\\". On failure: append_tracking_row({ section: \\"Failed approaches\\", entry: \\"- <reason>\\" }). Never Read or Edit the whole tracking file. Terminate when done.",`,
    "     })",
    "",
    "5. End your turn. Kanna will /clear your context and re-fire this exact",
    `   prompt after the subagent completes. Your ONLY durable state is ${trackingFileRel}.`,
    "",
    "HARD RULES (do not violate):",
    "- You are the orchestrator. NEVER edit code yourself: do NOT use Edit,",
    "  Write, MultiEdit, or the Task/Agent tool. Kanna blocks these tools in",
    "  loop turns; attempting them wastes the turn.",
    `- NEVER read the whole ${trackingFileRel}. Use mcp__kanna__query_tracking_file`,
    "  (read) and mcp__kanna__append_tracking_row (write) so the file stays off",
    "  your context no matter how large it grows.",
    "- Exactly ONE delegate_subagent per turn, then END THE TURN immediately.",
    "- All progress lives in the tracking file, never in your context.",
    "",
    `Goal (for reference): ${goal}`,
    `Verify command: \`${verifyCommand}\``,
  ].join("\n")
}

interface SkeletonArgs {
  goal: string
  verifyCommand: string
  chunkHint: string | null
}

const DEFAULT_PREAMBLE_LINES: readonly string[] = ["# Loop tracking file", ""]

/**
 * The five canonical tracking-file sections, in fixed order. `serverOwned`
 * sections carry setup_loop inputs and are rewritten on mismatch; the rest
 * belong to the loop (subagent-appended history) and are preserved verbatim.
 * Both the skeleton and the reconcile derive from this single table so the
 * two can never drift.
 */
const CANONICAL_SECTIONS: readonly {
  heading: string
  serverOwned: boolean
  matches: (normalizedHeading: string) => boolean
  canonicalBodyLines: (args: SkeletonArgs) => string[]
}[] = [
  {
    heading: "## Goal",
    serverOwned: true,
    matches: (h) => h === "goal",
    canonicalBodyLines: (args) => [args.goal, ""],
  },
  {
    heading: "## Verify command",
    serverOwned: true,
    matches: (h) => h === "verify command",
    canonicalBodyLines: (args) => ["```", args.verifyCommand, "```", ""],
  },
  {
    heading: "## Progress (latest first)",
    serverOwned: false,
    matches: (h) => h.startsWith("progress"),
    canonicalBodyLines: () => ["", "_Subagent appends one row per completed chunk here._", ""],
  },
  {
    heading: "## Failed approaches",
    serverOwned: false,
    matches: (h) => h.startsWith("failed approaches"),
    canonicalBodyLines: () => ["", "_Subagent appends dead-ends here so future iterations don't repeat them._", ""],
  },
  {
    heading: "## Next chunk",
    serverOwned: false,
    matches: (h) => h.startsWith("next chunk"),
    canonicalBodyLines: (args) => ["", args.chunkHint ?? "_Describe the first chunk the subagent should do._", ""],
  },
]

/** Skeleton written to disk when the tracking file does not exist yet. */
function renderSkeleton(args: SkeletonArgs): string {
  return [
    ...DEFAULT_PREAMBLE_LINES,
    ...CANONICAL_SECTIONS.flatMap((s) => [s.heading, ...s.canonicalBodyLines(args)]),
  ].join("\n")
}

export interface TrackingFileReconcile {
  /** Deterministically reconciled file content. Equal to the input when `changed` is false. */
  content: string
  changed: boolean
  /** Ordered section-level actions taken, e.g. `rewrote "## Goal"`. Empty when `changed` is false. */
  actions: string[]
}

interface ParsedSection {
  /** Heading text after "## ", trimmed + lowercased, for matching. */
  normalizedHeading: string
  /** Raw lines including the heading line — reassembled verbatim when preserved. */
  lines: string[]
}

function parseSections(existing: string): { preamble: string[]; sections: ParsedSection[] } {
  const lines = existing.split("\n")
  const preamble: string[] = []
  const sections: ParsedSection[] = []
  let current: ParsedSection | null = null
  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = { normalizedHeading: line.slice(3).trim().toLowerCase(), lines: [line] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  return { preamble, sections }
}

/**
 * Deterministically reconcile an EXISTING tracking file against the loop's
 * canonical schema — a pure string transform, no model judgement involved:
 *
 * - Server-owned sections (`## Goal`, `## Verify command`) are rewritten in
 *   place when their content differs from the setup_loop inputs.
 * - Loop-owned sections (`## Progress`, `## Failed approaches`, `## Next
 *   chunk`) are preserved verbatim when present and inserted from the
 *   skeleton when missing — accumulated history is never destroyed.
 * - A preamble above the first section and any unknown sections are
 *   preserved verbatim (unknowns move after the canonical five).
 *
 * A file that already conforms round-trips byte-identical (`changed: false`).
 */
export function reconcileTrackingFile(existing: string, args: SkeletonArgs): TrackingFileReconcile {
  const { preamble, sections } = parseSections(existing)
  const actions: string[] = []
  const claimed = new Set<ParsedSection>()

  const out: string[] = preamble.some((l) => l.trim() !== "")
    ? [...preamble]
    : [...DEFAULT_PREAMBLE_LINES]

  for (const spec of CANONICAL_SECTIONS) {
    const match = sections.find((s) => !claimed.has(s) && spec.matches(s.normalizedHeading))
    if (!match) {
      out.push(spec.heading, ...spec.canonicalBodyLines(args))
      actions.push(`inserted "${spec.heading}"`)
      continue
    }
    claimed.add(match)
    const bodyConforms =
      !spec.serverOwned
      || match.lines.slice(1).join("\n").trim() === spec.canonicalBodyLines(args).join("\n").trim()
    if (bodyConforms) {
      out.push(...match.lines)
    } else {
      out.push(spec.heading, ...spec.canonicalBodyLines(args))
      actions.push(`rewrote "${spec.heading}"`)
    }
  }

  for (const section of sections) {
    if (!claimed.has(section)) out.push(...section.lines)
  }

  const content = out.join("\n")
  const changed = content !== existing
  if (changed && actions.length === 0) actions.push("normalized formatting")
  return { content, changed, actions: changed ? actions : [] }
}

/**
 * Validate + resolve a loop setup. Pure. Returns either a rejection with a
 * flat list of user-facing errors, or the fully-resolved payload the caller
 * uses to (a) ensure the tracking file exists on disk and (b) enqueue the
 * templated prompt as an auto-continue.
 */
export function validateLoopSetup(
  input: LoopSetupInput,
  cwd: string,
  context: LoopSetupContext,
): LoopSetupValidation {
  const errors: string[] = []

  if (!isNonBlankString(input.goal)) {
    errors.push("goal is required and must be a non-empty string")
  }

  if (!isNonBlankString(input.verifyCommand)) {
    errors.push("verifyCommand is required and must be a non-empty string")
  } else if (!shellCommandIsParseable(input.verifyCommand)) {
    errors.push("verifyCommand is not a parseable shell command (unmatched quotes / empty)")
  }

  if (input.chunkHint !== undefined && typeof input.chunkHint !== "string") {
    errors.push("chunkHint must be a string when provided")
  }

  // Resolve the worker: explicit param wins, else the configured default.
  const requestedSubagentId = isNonBlankString(input.subagentId)
    ? input.subagentId.trim()
    : (context.defaultLoopSubagentId ?? null)
  if (!requestedSubagentId) {
    errors.push("subagentId is required: pass it explicitly or set a default loop subagent in Settings")
  } else if (!context.roster.some((s) => s.id === requestedSubagentId)) {
    errors.push(`subagentId "${requestedSubagentId}" is not a known subagent`)
  }

  const resolved = resolveTrackingFile(input.trackingFile, cwd)
  if ("error" in resolved) errors.push(resolved.error)

  if (errors.length > 0) return { ok: false, errors }
  if ("error" in resolved) return { ok: false, errors: [resolved.error] } // unreachable; narrows type
  if (requestedSubagentId === null) return { ok: false, errors: ["internal: subagentId unresolved"] } // narrows type
  const subagentId = requestedSubagentId

  const chunkHint = input.chunkHint?.trim() ? input.chunkHint.trim() : null
  const goal = input.goal.trim()
  const verifyCommand = input.verifyCommand.trim()
  const prompt = renderLoopPrompt({
    goal,
    verifyCommand,
    trackingFileRel: resolved.rel,
    subagentId,
  })

  // Belt-and-suspenders structural check on the rendered prompt. Guards
  // against future edits to `renderLoopPrompt` that would silently drop a
  // required clause. Every entry MUST appear verbatim in the rendered text.
  const requiredSubstrings: readonly string[] = [
    resolved.rel,
    verifyCommand,
    subagentId,
    "delegate_subagent",
    "run_in_background: true",
    "stop_loop",
    "query_tracking_file",
    "append_tracking_row",
    "GOAL MET",
    "END THIS TURN",
    "/clear",
    "NEVER edit code yourself",
  ]
  const missing = requiredSubstrings.filter((s) => !prompt.includes(s))
  if (missing.length > 0) {
    return {
      ok: false,
      errors: [`internal: rendered template is missing required clauses: ${missing.join(", ")}`],
    }
  }

  return {
    ok: true,
    resolved: {
      goal,
      verifyCommand,
      trackingFileAbs: resolved.abs,
      trackingFileRel: resolved.rel,
      chunkHint,
      subagentId,
      prompt,
      skeleton: renderSkeleton({ goal, verifyCommand, chunkHint }),
    },
  }
}

export const __testing = { renderLoopPrompt, renderSkeleton, resolveTrackingFile }
