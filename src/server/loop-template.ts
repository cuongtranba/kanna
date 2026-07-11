/**
 * Loop-template renderer + validator (pure).
 *
 * Feeds `mcp__kanna__setup_loop`. Server owns the template so `/loop` setups
 * are deterministic — user prompt like "set up /loop and goal to do X" flows
 * through validation before the model can start looping. See
 * adr-2026XXXX-setup-loop-template.
 *
 * NO IO. Path resolution is on absolute strings only; caller supplies both
 * `cwd` and any user-provided `trackingFile` and this module normalizes /
 * confines. File creation happens in `loop-template-io.adapter.ts`.
 */

import path from "node:path"
import { parse as shellParse } from "shell-quote"

const DEFAULT_TRACKING_FILE = "PROGRESS.md"
const MAX_GOAL_LEN = 500
const MAX_CHUNK_HINT_LEN = 2000

export interface LoopSetupInput {
  /** Human-readable goal. Kept short — the model doesn't need prose here. */
  goal: string
  /** Verify command run in the project cwd. Exit code 0 = goal met. */
  verifyCommand: string
  /** Optional path (relative to cwd or absolute-inside-cwd). Default PROGRESS.md at cwd root. */
  trackingFile?: string
  /** Optional starter description of the first chunk written into the skeleton. */
  chunkHint?: string
}

export interface ResolvedLoopSetup {
  goal: string
  verifyCommand: string
  /** Absolute path inside `cwd`. */
  trackingFileAbs: string
  /** Path relative to `cwd`; the prompt embeds this. */
  trackingFileRel: string
  chunkHint: string | null
  /** The full recurring prompt the main agent will re-execute each iteration. */
  prompt: string
  /** Skeleton written when `trackingFileAbs` does not exist yet. */
  skeleton: string
}

export type LoopSetupValidation =
  | { ok: true; resolved: ResolvedLoopSetup }
  | { ok: false; errors: string[] }

function isNonBlankString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

function shellCommandIsParseable(cmd: string): boolean {
  // Balanced quotes: shell-quote is intentionally lenient (an unclosed quote
  // parses to two tokens rather than throwing), so we enforce quote balance
  // explicitly. Ignore quote chars escaped with a preceding backslash.
  let singles = 0
  let doubles = 0
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i]
    if (ch === "\\") { i += 1; continue }
    if (ch === "'") singles += 1
    else if (ch === "\"") doubles += 1
  }
  if (singles % 2 !== 0 || doubles % 2 !== 0) return false

  try {
    const tokens = shellParse(cmd)
    // Empty token list = all-whitespace or comment-only line: reject.
    return tokens.length > 0
  } catch {
    return false
  }
}

/** Resolve a user-supplied tracking-file path against `cwd`; reject escapes. */
function resolveTrackingFile(
  input: string | undefined,
  cwd: string,
): { abs: string; rel: string } | { error: string } {
  const raw = (input ?? DEFAULT_TRACKING_FILE).trim()
  if (raw === "") return { error: "trackingFile is blank" }
  const normalized = raw.replaceAll("\\", "/")
  if (normalized.includes("\0")) return { error: "trackingFile contains a NUL byte" }
  const cwdAbs = path.resolve(cwd)
  const abs = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(cwdAbs, normalized)
  const rel = path.relative(cwdAbs, abs)
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { error: `trackingFile must resolve inside the project cwd (${cwd})` }
  }
  return { abs, rel }
}

/** Deterministic prompt for the main agent, replayed each loop iteration. */
function renderLoopPrompt(args: {
  goal: string
  verifyCommand: string
  trackingFileRel: string
}): string {
  const { goal, verifyCommand, trackingFileRel } = args
  return [
    "You are running an autonomous loop. Follow these steps EXACTLY every turn:",
    "",
    `1. Read ${trackingFileRel}.`,
    `2. Run the verify command with Bash: \`${verifyCommand}\`. Check its exit code.`,
    "3. If the verify command exited 0, the goal is met. Print a one-line",
    `   "GOAL MET: ${goal}" message and END THIS TURN. Do NOT call`,
    "   delegate_subagent. The loop ends by absence of delegation.",
    "4. Otherwise, pick the \"Next chunk\" from the tracking file and delegate it",
    "   to an appropriate subagent from your roster:",
    "",
    "     mcp__kanna__delegate_subagent({",
    "       subagent_id: <pick appropriate id from your roster>,",
    "       run_in_background: true,",
    `       prompt: "Do the next chunk in ${trackingFileRel}. Verify locally with \`${verifyCommand}\`. On success: append a Progress row to ${trackingFileRel} (chunk done + timestamp) and set the next chunk. On failure: append a Failed-approaches row with a short reason. Terminate when done.",`,
    "     })",
    "",
    "5. End your turn. Kanna will /clear your context and re-fire this exact",
    `   prompt after the subagent completes. Your ONLY durable state is ${trackingFileRel}.`,
    "",
    `Goal (for reference): ${goal}`,
    `Verify command: \`${verifyCommand}\``,
  ].join("\n")
}

/** Skeleton written to disk when the tracking file does not exist yet. */
function renderSkeleton(args: {
  goal: string
  verifyCommand: string
  chunkHint: string | null
}): string {
  return [
    "# Loop tracking file",
    "",
    "## Goal",
    args.goal,
    "",
    "## Verify command",
    "```",
    args.verifyCommand,
    "```",
    "",
    "## Progress (latest first)",
    "",
    "_Subagent appends one row per completed chunk here._",
    "",
    "## Failed approaches",
    "",
    "_Subagent appends dead-ends here so future iterations don't repeat them._",
    "",
    "## Next chunk",
    "",
    args.chunkHint ?? "_Describe the first chunk the subagent should do._",
    "",
  ].join("\n")
}

/**
 * Validate + resolve a loop setup. Pure. Returns either a rejection with a
 * flat list of user-facing errors, or the fully-resolved payload the caller
 * uses to (a) ensure the tracking file exists on disk and (b) enqueue the
 * templated prompt as an auto-continue.
 */
export function validateLoopSetup(input: LoopSetupInput, cwd: string): LoopSetupValidation {
  const errors: string[] = []

  if (!isNonBlankString(input.goal)) {
    errors.push("goal is required and must be a non-empty string")
  } else if (input.goal.length > MAX_GOAL_LEN) {
    errors.push(`goal exceeds max length ${MAX_GOAL_LEN}`)
  }

  if (!isNonBlankString(input.verifyCommand)) {
    errors.push("verifyCommand is required and must be a non-empty string")
  } else if (!shellCommandIsParseable(input.verifyCommand)) {
    errors.push("verifyCommand is not a parseable shell command (unmatched quotes / empty)")
  }

  if (input.chunkHint !== undefined) {
    if (typeof input.chunkHint !== "string") {
      errors.push("chunkHint must be a string when provided")
    } else if (input.chunkHint.length > MAX_CHUNK_HINT_LEN) {
      errors.push(`chunkHint exceeds max length ${MAX_CHUNK_HINT_LEN}`)
    }
  }

  const resolved = resolveTrackingFile(input.trackingFile, cwd)
  if ("error" in resolved) errors.push(resolved.error)

  if (errors.length > 0) return { ok: false, errors }
  if ("error" in resolved) return { ok: false, errors: [resolved.error] } // unreachable; narrows type

  const chunkHint = input.chunkHint?.trim() ? input.chunkHint.trim() : null
  const goal = input.goal.trim()
  const verifyCommand = input.verifyCommand.trim()
  const prompt = renderLoopPrompt({
    goal,
    verifyCommand,
    trackingFileRel: resolved.rel,
  })

  // Belt-and-suspenders structural check on the rendered prompt. Guards
  // against future edits to `renderLoopPrompt` that would silently drop a
  // required clause. Every entry MUST appear verbatim in the rendered text.
  const requiredSubstrings: readonly string[] = [
    resolved.rel,
    verifyCommand,
    "delegate_subagent",
    "run_in_background: true",
    "GOAL MET",
    "END THIS TURN",
    "/clear",
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
      prompt,
      skeleton: renderSkeleton({ goal, verifyCommand, chunkHint }),
    },
  }
}

export const __testing = { renderLoopPrompt, renderSkeleton, resolveTrackingFile }
