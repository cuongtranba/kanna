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

import path from "node:path"

import { APPEND_TRACKING_ROW_TOOL_NAME, DELEGATE_SUBAGENT_TOOL_NAME, QUERY_TRACKING_FILE_TOOL_NAME, REPLACE_TRACKING_SECTION_TOOL_NAME, STOP_LOOP_TOOL_NAME } from "../shared/tools"
import { LOOP_SECTIONS, LOOP_STEP_INVARIANTS } from "../shared/loop-progress"
import { confinePathToDir, shellCommandIsParseable } from "./input-validation"

export { decideLoopAction, LOOP_SECTIONS, type LoopAction, type LoopChunkState, type LoopOracleExit } from "../shared/loop-progress"

const DEFAULT_TRACKING_FILE = "PROGRESS.md"

/**
 * Upper bound on `parallelism`, matched to the subagent permit pool's default
 * concurrency (4). Asking for more would just queue behind permits, so the cap
 * keeps the rendered promise honest rather than adding real throughput.
 */
export const MAX_PARALLELISM = 4

export interface LoopSetupInput {
  /** Human-readable goal. Kept short — the model doesn't need prose here. */
  goal: string
  /** Verify command run in `workdir`. Exit code 0 = goal met. */
  verifyCommand: string
  /** Optional path (relative to `workdir`, or absolute inside it). Default PROGRESS.md at its root. */
  trackingFile?: string
  /** Optional starter description of the first chunk written into the skeleton. */
  chunkHint?: string
  /**
   * Subagent the loop delegates each chunk to. Optional: when omitted the
   * caller's configured `defaultLoopSubagentId` is used. Resolution, roster
   * membership AND trigger mode are all validated so the loop never discovers
   * an unusable worker at runtime.
   */
  subagentId?: string
  /**
   * Absolute directory the loop works in — where the verify command runs and
   * where `trackingFile` is rooted. Defaults to the project cwd.
   *
   * Exists because the house rule is "always use a git worktree", so the work
   * routinely lives in a SIBLING directory of the project checkout. Without
   * this the tracking file is pinned to the project cwd while the branch it
   * describes lives elsewhere, stranding the plan away from the code. Proving
   * this is a worktree of the same repo needs git IO, so that check belongs to
   * the caller, not to this pure module.
   */
  workdir?: string
  /**
   * How many chunks the orchestrator may delegate in one turn. Default 1
   * (strictly serial — the historical behaviour). Above 1 the rendered prompt
   * only permits chunks the plan explicitly marks `[parallel]`, each pinned to
   * its own worktree, so an unmarked plan stays serial regardless.
   */
  parallelism?: number
  /**
   * Permit reconciling a git-TRACKED tracking file whose goal differs from
   * this setup. Off by default: silently rewriting committed sections of a
   * previous loop's record is data loss. See `assertTrackingFileSafe`.
   */
  force?: boolean
}

/**
 * Loop-setup context the caller supplies: the current subagent roster and the
 * configured default loop subagent. Kept separate from `LoopSetupInput`
 * because it is server state, not model-supplied args.
 *
 * `triggerMode` is part of the roster on purpose. It used to be dropped at the
 * call site, so a manual-trigger subagent armed a loop happily and the
 * `MANUAL_ONLY` refusal only surfaced at the first delegation — one full
 * iteration later, after the context wipe, with no way back except a human.
 */
export interface LoopSetupContext {
  roster: readonly { id: string; name: string; triggerMode: "auto" | "manual" }[]
  defaultLoopSubagentId: string | null
}

export interface ResolvedLoopSetup {
  goal: string
  verifyCommand: string
  /** Absolute directory the verify command runs in and the tracking file is rooted at. */
  workdirAbs: string
  /** `workdirAbs` relative to the project cwd (`.` when they are the same); the prompt embeds this. */
  workdirRel: string
  /** Absolute path inside `workdirAbs`. */
  trackingFileAbs: string
  /** Path relative to `workdirAbs`; the prompt embeds this. */
  trackingFileRel: string
  chunkHint: string | null
  /** Concrete subagent id the loop delegates to (never null after resolve). */
  subagentId: string
  /** Chunks the orchestrator may delegate per turn (>= 1). */
  parallelism: number
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

/** Resolve a user-supplied tracking-file path against `workdir`; reject escapes. */
function resolveTrackingFile(
  input: string | undefined,
  workdir: string,
): { abs: string; rel: string } | { error: string } {
  return confinePathToDir(input ?? DEFAULT_TRACKING_FILE, workdir, "trackingFile")
}

/**
 * The delegation rule, which is the one clause that varies with `parallelism`.
 * At the default of 1 the loop is strictly serial. Above 1 we still refuse to
 * infer independence: only chunks the PLAN marks `[parallel]` may fan out, and
 * each must name its own worktree, because two workers sharing one checkout
 * corrupt each other's edits.
 */
function renderDelegationRule(parallelism: number): string[] {
  if (parallelism <= 1) {
    return ["- Exactly ONE delegate_subagent per turn, then END THE TURN immediately."]
  }
  return [
    `- You may delegate up to ${parallelism} chunks in this turn, but ONLY chunks the plan`,
    "  explicitly marks `[parallel]`, and each one must name its OWN git worktree",
    "  — two workers sharing a checkout will corrupt each other's edits.",
    "  If the chunks are not marked, delegate exactly ONE. Then END THE TURN.",
  ]
}

/** Deterministic prompt for the main agent, replayed each loop iteration. */
function renderLoopPrompt(args: {
  goal: string
  verifyCommand: string
  trackingFileRel: string
  subagentId: string
  parallelism: number
  workdirRel: string
}): string {
  const { goal, verifyCommand, trackingFileRel, subagentId, parallelism, workdirRel } = args
  const f = `file: "${trackingFileRel}"`
  // `.` is the project root; naming it that way reads better than a bare dot
  // in the middle of a sentence, and keeps the worktree case unambiguous.
  const workdirPhrase = workdirRel === "." ? "the project root" : workdirRel
  // The worker's brief. Every tracking-file call names the file explicitly:
  // omitting it defaulted the worker to PROGRESS.md, which is how a worker
  // once wrote its progress row into a DIFFERENT loop's committed file.
  const workerPrompt = [
    // Leading chunk marker: the ONE substitution the orchestrator makes in an
    // otherwise verbatim call. Everything after it is identical every
    // iteration, so without the marker the Progress panel showed the same
    // boilerplate row over and over instead of the chunk being worked.
    "[chunk: <one-line summary of the Next chunk you just read>]",
    `Do the next chunk in ${trackingFileRel}. All work happens in ${workdirPhrase}.`,
    `To read the plan, call ${QUERY_TRACKING_FILE_TOOL_NAME}({ ${f}, sections: [\\"${LOOP_SECTIONS.nextChunk}\\"] })`,
    "— by section, never the whole file.",
    `Verify your work with \`${verifyCommand}\` before you report success.`,
    "On success: call",
    `${APPEND_TRACKING_ROW_TOOL_NAME}({ ${f}, section: \\"${LOOP_SECTIONS.progress}\\", entry: \\"- <date> <chunk> DONE\\", position: \\"top\\" })`,
    "and then REPLACE the plan's next step with",
    `${REPLACE_TRACKING_SECTION_TOOL_NAME}({ ${f}, section: \\"${LOOP_SECTIONS.nextChunk}\\", body: \\"<the single next chunk, or DONE if the plan is finished>\\" })`,
    "— replace, never append, or completed chunks pile up and get redone.",
    // The pre-DONE re-read exists because a worker once wrote DONE while five
    // undone chunks sat in a section it had never been shown; the whole loop
    // then terminated on a green-but-weak oracle.
    "Before writing DONE, run the TERMINAL CHECK: call",
    `${QUERY_TRACKING_FILE_TOOL_NAME}({ ${f} })`,
    "with NO sections filter — the one whole-file read you are allowed — and",
    "confirm no other section still lists undone work; if one does, write that",
    `work into ${LOOP_SECTIONS.nextChunk} instead of DONE.`,
    "On failure: call",
    `${APPEND_TRACKING_ROW_TOOL_NAME}({ ${f}, section: \\"${LOOP_SECTIONS.failedApproaches}\\", entry: \\"- <what you tried and why it failed>\\" })`,
    "so the next iteration does not repeat it.",
    "Never Read or Edit the whole tracking file. Terminate when done.",
  ].join(" ")

  return [
    "You are the ORCHESTRATOR of an autonomous loop. You do NOT do the work",
    "yourself — you delegate it. Follow these steps EXACTLY every turn:",
    "",
    `1. Read the current plan by SECTION — do NOT read the whole ${trackingFileRel}.`,
    `   Call ${QUERY_TRACKING_FILE_TOOL_NAME}({ ${f}, sections: ["${LOOP_SECTIONS.nextChunk}", "${LOOP_SECTIONS.progress}"], list_limit: 5 })`,
    "   This keeps the file off your context as it grows.",
    `2. Run the verify command (the ORACLE) with Bash, from ${workdirPhrase}:`,
    `   \`${verifyCommand}\`. Check its exit code.`,
    "3. Decide, using BOTH signals — the oracle is only a proxy, the plan is the",
    "   authority. Four cases:",
    `   (a) oracle exited 0 AND "${LOOP_SECTIONS.nextChunk}" is empty / says DONE → run the`,
    "       TERMINAL CHECK before declaring victory: call",
    `       ${QUERY_TRACKING_FILE_TOOL_NAME}({ ${f} })`,
    "       with NO sections filter — the one whole-file read you are allowed —",
    "       and scan EVERY section, including non-canonical ones (a \"## Chunks\"",
    "       or \"## Plan\" list), for undone work. Work found → treat as case (b).",
    `       Only if the whole plan is exhausted: print "GOAL MET: ${goal}",`,
    `       call ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN. Do NOT call`,
    "       delegate_subagent.",
    `   (b) oracle exited 0 BUT "${LOOP_SECTIONS.nextChunk}" still lists real work — or the`,
    "       TERMINAL CHECK found undone work in any other section → the oracle",
    "       is too weak to define done. Print",
    "       \"ORACLE TOO WEAK: <what the plan still lists>\", call",
    `       ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN so a human can tighten`,
    "       it. Do NOT declare the goal met, and do NOT delegate.",
    `   (c) oracle failed AND "${LOOP_SECTIONS.nextChunk}" has work → normal case, go to step 4.`,
    `   (d) oracle failed BUT "${LOOP_SECTIONS.nextChunk}" is empty → the plan ran out while the`,
    "       goal is unmet. Write the next step yourself with",
    `       ${REPLACE_TRACKING_SECTION_TOOL_NAME}({ ${f}, section: "${LOOP_SECTIONS.nextChunk}", body: "<one concrete chunk>" })`,
    "       then go to step 4.",
    `4. Delegate the "${LOOP_SECTIONS.nextChunk}" work with EXACTLY this call (the subagent is`,
    "   fixed by configuration), making the ONE substitution marked below:",
    "",
    `     ${DELEGATE_SUBAGENT_TOOL_NAME}({`,
    `       subagent_id: "${subagentId}",`,
    "       run_in_background: true,",
    `       prompt: "${workerPrompt}",`,
    "     })",
    "",
    "   Replace `<one-line summary of the Next chunk you just read>` inside the",
    "   leading `[chunk: …]` marker with a short name for the chunk you are",
    "   delegating (e.g. `[chunk: Wire session tabs to the store]`). It is how",
    "   this iteration is labelled in the UI, and it is the only edit you make",
    "   to that prompt — leave every other word verbatim.",
    "",
    "5. If THIS turn began with a task-notification reporting a FAILED run, class",
    "   the failure before you re-delegate:",
    "   - INFRA (AUTH_REQUIRED, CAP_EXCEEDED, DEPTH_EXCEEDED, timeout, spawn",
    "     failure): the work was never attempted. Re-delegate the SAME chunk",
    "     unchanged and do NOT call stop_loop — Kanna disarms the loop itself",
    "     after repeated failures, so stopping here just costs a human round-trip.",
    "   - WORK (the worker ran and could not finish): record it with",
    `     ${APPEND_TRACKING_ROW_TOOL_NAME}({ ${f}, section: "${LOOP_SECTIONS.failedApproaches}", entry: "- <reason>" })`,
    "     then delegate a DIFFERENT approach to the same chunk.",
    "6. End your turn. Kanna will /clear your context and re-fire this exact",
    `   prompt after the worker completes. Your ONLY durable state is ${trackingFileRel}.`,
    "",
    "HARD RULES (do not violate):",
    "- You are the orchestrator. NEVER edit code yourself: do NOT use Edit,",
    "  Write, MultiEdit, or the Task/Agent tool. Kanna blocks these tools in",
    "  loop turns; attempting them wastes the turn.",
    `- NEVER read the whole ${trackingFileRel} — EXCEPT the single TERMINAL CHECK`,
    `  in step 3(a). Use ${QUERY_TRACKING_FILE_TOOL_NAME}`,
    `  (read), ${APPEND_TRACKING_ROW_TOOL_NAME} and`,
    `  ${REPLACE_TRACKING_SECTION_TOOL_NAME} (write) so the file stays off your`,
    "  context no matter how large it grows.",
    ...renderDelegationRule(parallelism),
    "- All progress lives in the tracking file, never in your context.",
    "",
    `Goal (for reference): ${goal}`,
    `Verify command: \`${verifyCommand}\``,
    `Work directory: ${workdirRel}`,
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
    heading: `## ${LOOP_SECTIONS.progress} (latest first)`,
    serverOwned: false,
    matches: (h) => h.startsWith("progress"),
    canonicalBodyLines: () => ["", "_Subagent appends one row per completed chunk here._", ""],
  },
  {
    heading: `## ${LOOP_SECTIONS.failedApproaches}`,
    serverOwned: false,
    matches: (h) => h.startsWith("failed approaches"),
    canonicalBodyLines: () => ["", "_Subagent appends dead-ends here so future iterations don't repeat them._", ""],
  },
  {
    heading: `## ${LOOP_SECTIONS.nextChunk}`,
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

export type TrackingFileSafety = { ok: true } | { ok: false; error: string }

/**
 * Second-phase guard, applied by the caller once it has READ the existing
 * tracking file and asked git whether it is tracked. Pure: the caller does the
 * IO, this decides.
 *
 * `reconcileTrackingFile` rewrites the server-owned `## Goal` / `## Verify
 * command` sections in place. That is right for a scratch file and wrong for a
 * committed one: a `setup_loop` for a NEW goal once silently overwrote the
 * committed record of a previous, finished loop, and the only reason it was
 * not lost is that a human happened to re-read the file and `git checkout`ed
 * it. So: if the file is git-tracked and already declares a DIFFERENT goal,
 * refuse and make the caller pick a different tracking file or pass `force`.
 *
 * Deliberately narrow — an untracked file, a matching goal (idempotent
 * re-arm), or a file with no `## Goal` yet all pass straight through.
 */
export function assertTrackingFileSafe(
  existing: string,
  args: { goal: string; gitTracked: boolean; force: boolean },
): TrackingFileSafety {
  if (!args.gitTracked || args.force) return { ok: true }

  const { sections } = parseSections(existing)
  const goalSection = sections.find((s) => s.normalizedHeading === "goal")
  if (!goalSection) return { ok: true }

  const existingGoal = goalSection.lines.slice(1).join("\n").trim()
  if (existingGoal.length === 0 || existingGoal === args.goal.trim()) return { ok: true }

  return {
    ok: false,
    error:
      "refusing to overwrite a git-tracked tracking file that records a different goal"
      + ` (existing goal: "${existingGoal.split("\n")[0]}").`
      + " Pass a different trackingFile for this loop, or force: true to overwrite it.",
  }
}

/**
 * Locate the shell script a verify command runs, so the caller can read it
 * for the arm-time oracle audit. Token-based on purpose: `bash x.sh`,
 * `sh -x ./gate.bash` and a bare `./check.sh --fast` all resolve, while
 * `bun run lint` returns null. A quoted path containing spaces is not
 * resolved — the audit then falls back to the command string, which is the
 * safe direction (silence, never a wrong read).
 */
export function extractOracleScriptPath(verifyCommand: string): string | null {
  for (const raw of verifyCommand.split(/\s+/)) {
    const token = raw.replace(/^["']|["']$/g, "")
    if (token.startsWith("-")) continue
    if (/\.(?:sh|bash)$/.test(token)) return token
  }
  return null
}

/**
 * Existence-probe / grep shapes that can pass without the behavior existing:
 * `test -f`, `[ -f … ]`, `grep -q|-c|-L`, and the `ls … /dev/null` idiom.
 * A loop's definition of done built from these declared GOAL MET over a
 * feature whose new code nothing called — every marker was satisfied by
 * files that existed but were never wired in.
 */
const WEAK_ORACLE_PATTERNS: readonly RegExp[] = [
  /(?:^|[^\w-])test\s+(?:!\s+)?-[defs]\b/gm,
  /\[\[?\s+(?:!\s+)?-[defs]\s/gm,
  /(?:^|[^\w-])grep\s+(?:-\w+\s+)*-\w*[qcL]\w*(?=\s|$)/gm,
  /(?:^|[^\w-])ls\s+[^\n;|&]*\/dev\/null/gm,
]

/** Test-runner / gate invocations that assert behavior rather than presence. */
const STRONG_ORACLE_PATTERNS: readonly RegExp[] = [
  /\bbun\s+(?:run\s+)?(?:test|check|lint|typecheck)\b/,
  /\btask\s+\S*(?:check|test)\S*/,
  /\b(?:pnpm|npm|yarn)\s+(?:run\s+)?(?:test|check|lint|typecheck)\b/,
  /\b(?:vitest|jest|pytest|playwright|mocha|ava)\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+(?:test|check)\b/,
  /\bmvn\s+(?:test|verify)\b/,
  /\bmake\s+(?:test|check)\b/,
  /\btsc\b/,
  /\beslint\b/,
]

/**
 * Below this many weak markers a fail-fast probe in front of a real gate is a
 * normal optimization; at or above it the markers ARE the definition of done.
 */
const WEAK_MARKER_SOFT_LIMIT = 3

export interface OracleAuditInput {
  verifyCommand: string
  /** Script path extracted from the command (`extractOracleScriptPath`), or null. */
  scriptPath: string | null
  /** The referenced script's content; null when unreadable or not referenced. */
  scriptContent: string | null
}

/**
 * Arm-time static audit of the oracle's strength. Non-fatal by design — the
 * result is a warning list surfaced in the setup_loop reply, at the one
 * moment the operator can still tighten the command. The already-green
 * refusal proves the oracle can FAIL; this asks whether it can only pass for
 * the right reason.
 */
export function auditOracle(input: OracleAuditInput): string[] {
  if (input.scriptPath !== null && input.scriptContent === null) {
    return [
      `verify script ${input.scriptPath} could not be read at arm time, so its strength was`
      + " not audited — make sure it asserts behavior (tests), not file existence or greps.",
    ]
  }
  const text = input.scriptContent ?? input.verifyCommand
  const weak = WEAK_ORACLE_PATTERNS.reduce((n, p) => n + [...text.matchAll(p)].length, 0)
  if (weak === 0) return []
  const strong = STRONG_ORACLE_PATTERNS.some((p) => p.test(text))
  if (!strong) {
    return [
      `the oracle contains ${weak} file-existence/grep check(s) and no test-runner invocation,`
      + " so it can pass without the behavior existing. Prefer a RED test in the repo:"
      + " a grep is satisfied by an import line; a test is not.",
    ]
  }
  if (weak >= WEAK_MARKER_SOFT_LIMIT) {
    return [
      `the oracle gates its test run behind ${weak} file-existence/grep markers. Markers can`
      + " pass without behavior — make sure the suite itself contains RED tests for the"
      + " remaining work; a green legacy suite proves nothing about new work.",
    ]
  }
  return []
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
  } else {
    const worker = context.roster.find((s) => s.id === requestedSubagentId)
    if (!worker) {
      errors.push(`subagentId "${requestedSubagentId}" is not a known subagent`)
    } else if (worker.triggerMode === "manual") {
      // Arming here would wipe the context and only fail at the first
      // delegation, one iteration later, with MANUAL_ONLY.
      errors.push(
        `subagent "${worker.name}" is manual-trigger and cannot be driven by a loop:`
        + " the loop delegates automatically, with no @-mention to authorize it."
        + " Switch it to auto in Settings → Subagents, or pick an auto subagent.",
      )
    }
  }

  // The loop's working directory: an explicit worktree, else the project cwd.
  let workdirAbs = cwd
  if (input.workdir !== undefined) {
    if (!isNonBlankString(input.workdir) || !path.isAbsolute(input.workdir)) {
      errors.push("workdir must be a non-empty absolute path when provided")
    } else {
      workdirAbs = path.normalize(input.workdir.trim())
    }
  }

  const parallelism = input.parallelism ?? 1
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > MAX_PARALLELISM) {
    errors.push(`parallelism must be an integer between 1 and ${MAX_PARALLELISM}`)
  }

  // Tracking file is rooted at the WORKDIR, so a worktree loop keeps its plan
  // beside the branch it describes rather than back in the project checkout.
  const resolved = resolveTrackingFile(input.trackingFile, workdirAbs)
  if ("error" in resolved) errors.push(resolved.error)

  if (errors.length > 0) return { ok: false, errors }
  if ("error" in resolved) return { ok: false, errors: [resolved.error] } // unreachable; narrows type
  if (requestedSubagentId === null) return { ok: false, errors: ["internal: subagentId unresolved"] } // narrows type
  const subagentId = requestedSubagentId
  const workdirRel = workdirAbs === cwd ? "." : (path.relative(cwd, workdirAbs) || ".")

  const chunkHint = input.chunkHint?.trim() ? input.chunkHint.trim() : null
  const goal = input.goal.trim()
  const verifyCommand = input.verifyCommand.trim()
  const prompt = renderLoopPrompt({
    goal,
    verifyCommand,
    trackingFileRel: resolved.rel,
    subagentId,
    parallelism,
    workdirRel,
  })

  // Structural check on the rendered prompt. Derived from LOOP_STEP_INVARIANTS
  // so adding a new required clause to a step automatically enters the guard —
  // a hand-maintained list here was the bug this replaces (newly added clauses
  // were never required, and the check could not distinguish present from coherent).
  // Dynamic parts (file path, command, subagent id) are added separately.
  const requiredSubstrings: readonly string[] = [
    resolved.rel,
    verifyCommand,
    subagentId,
    ...LOOP_STEP_INVARIANTS.flatMap((step) => step.requires),
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
      workdirAbs,
      workdirRel,
      trackingFileAbs: resolved.abs,
      trackingFileRel: resolved.rel,
      chunkHint,
      subagentId,
      parallelism,
      prompt,
      skeleton: renderSkeleton({ goal, verifyCommand, chunkHint }),
    },
  }
}

export const __testing = { renderLoopPrompt, renderSkeleton, resolveTrackingFile }
