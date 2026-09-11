import { LOOP_SECTIONS } from "../shared/loop-progress"
import {
  APPEND_TRACKING_ROW_TOOL_NAME,
  CLAIM_TRACKING_TASK_TOOL_NAME,
  COMPLETE_TRACKING_TASK_TOOL_NAME,
  DELEGATE_SUBAGENT_TOOL_NAME,
  INTEGRATE_TRACKING_TASKS_TOOL_NAME,
  QUERY_TRACKING_FILE_TOOL_NAME,
  REPLACE_TRACKING_SECTION_TOOL_NAME,
  STOP_LOOP_TOOL_NAME,
} from "../shared/tools"

export interface ParallelPromptArgs {
  goal: string
  verifyCommand: string
  trackingFileRel: string
  subagentId: string
  parallelism: number
  workdirRel: string
  integrationBranch?: string
}

function renderWorkerPrompt(args: ParallelPromptArgs, f: string, integrationBranch: string): string {
  const { verifyCommand } = args
  return [
    "[chunk: <one-line summary of the task you claimed>]",
    "Do exactly this task: <task text from the claim>.",
    "All your work happens in its OWN git worktree at <worktree from the claim>.",
    "Every git call MUST be `git -C <worktree> …` and every path you touch must be",
    "inside that worktree — sibling workers own the other checkouts and editing",
    "theirs corrupts their work.",
    `First, pick up finished dependencies: run \`git -C <worktree> merge ${integrationBranch}\`.`,
    `Verify with \`${verifyCommand}\` run INSIDE <worktree> before you report success`,
    "— do not call run_verify, which checks the integration tree, not yours.",
    "On success: `git -C <worktree> add -A && git -C <worktree> commit -m \\\"<one-line task summary>\\\"`, then call",
    `${APPEND_TRACKING_ROW_TOOL_NAME}({ ${f}, section: \\"${LOOP_SECTIONS.progress}\\", entry: \\"- <date> <task> DONE\\", position: \\"top\\" })`,
    "and then release your lease with",
    `${COMPLETE_TRACKING_TASK_TOOL_NAME}({ ${f}, claim_id: \\"<claim_id>\\", outcome: \\"done\\" })`,
    "On failure: call",
    `${APPEND_TRACKING_ROW_TOOL_NAME}({ ${f}, section: \\"${LOOP_SECTIONS.failedApproaches}\\", entry: \\"- <what you tried and why it failed>\\" })`,
    "and then",
    `${COMPLETE_TRACKING_TASK_TOOL_NAME}({ ${f}, claim_id: \\"<claim_id>\\", outcome: \\"release\\" })`,
    "so the task returns to the queue instead of being lost.",
    "Never Read or Edit the whole tracking file. Terminate when done.",
  ].join(" ")
}

export function renderParallelLoopPrompt(args: ParallelPromptArgs): string {
  const { goal, verifyCommand, trackingFileRel, subagentId, parallelism, workdirRel } = args
  const integrationBranch = args.integrationBranch ?? "HEAD"
  const f = `file: "${trackingFileRel}"`
  const workdirPhrase = workdirRel === "." ? "the project root" : workdirRel
  const queue = LOOP_SECTIONS.taskQueue

  return [
    "You are the ORCHESTRATOR of an autonomous PARALLEL loop. You do NOT do the",
    `work yourself — you delegate it to at most ${parallelism} workers at a time.`,
    "Follow these steps EXACTLY every turn:",
    "",
    "1. Integrate finished work BEFORE you claim anything. Call",
    `   ${INTEGRATE_TRACKING_TASKS_TOOL_NAME}({ ${f} })`,
    `   It merges every task branch that is done but not yet integrated into`,
    `   ${integrationBranch} and reports any conflict. If it reports one, print`,
    "   \"QUEUE BLOCKED: <the conflict>\", call",
    `   ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN — a conflict between sibling`,
    "   tasks is a plan defect only a human can repair.",
    `2. Read the plan by SECTION — do NOT read the whole ${trackingFileRel}. Call`,
    `   ${QUERY_TRACKING_FILE_TOOL_NAME}({ ${f}, sections: ["${queue}", "${LOOP_SECTIONS.progress}"], list_limit: 5 })`,
    `3. Run the verify command (the ORACLE) with Bash, from ${workdirPhrase}:`,
    `   \`${verifyCommand}\`. Check its exit code.`,
    `4. Claim work. Call ${CLAIM_TRACKING_TASK_TOOL_NAME}({ ${f} }) up to`,
    `   ${parallelism} times. Each call atomically leases ONE task and returns its`,
    "   id, text, worktree and claim_id — or tells you why nothing was claimable.",
    "   Decide from BOTH the oracle and what the claim reports:",
    "   (a) oracle exited 0 AND the claim reports the queue EXHAUSTED → run the",
    "       TERMINAL CHECK before declaring victory: call",
    `       ${QUERY_TRACKING_FILE_TOOL_NAME}({ ${f} })`,
    "       with NO sections filter — the one whole-file read you are allowed —",
    "       and scan EVERY section, including non-canonical ones, for undone work.",
    "       Work found → treat as case (b). Otherwise run `git log --oneline -20`",
    `       in ${workdirPhrase} and print a loop-end summary: how many commits were`,
    "       made, what each covers, and what the user should do next. Then print",
    `       "GOAL MET: ${goal}", call ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN.`,
    `   (b) oracle exited 0 BUT "${queue}" still lists real work → print`,
    "       \"ORACLE TOO WEAK: <what the plan still lists>\", call",
    `       ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN so a human can tighten it.`,
    "   (c) at least one claim succeeded → go to step 5 and delegate each one.",
    "   (d) the claim reports WAIT — every remaining task is waiting on one a live",
    "       worker still holds → print \"WAIT: <what it is waiting on>\" and END",
    `       THIS TURN. do NOT delegate and do NOT call ${STOP_LOOP_TOOL_NAME}: the`,
    "       worker that finishes will wake you with this prompt again.",
    "   (e) the claim reports QUEUE BLOCKED — nothing claimable and no live worker",
    "       (a dependency cycle, an unknown `needs:` id, or a task with no",
    "       `worktree:`) → print \"QUEUE BLOCKED: <the reason it gave>\", call",
    `       ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN.`,
    `   (f) the oracle failed but "${queue}" is empty → write the next tasks`,
    "       yourself with",
    `       ${REPLACE_TRACKING_SECTION_TOOL_NAME}({ ${f}, section: "${queue}", body: "<one task per line>" })`,
    "       using the line format",
    "       `- [ ] <id> <task> | needs: <id>,<id> | worktree: <path> | branch: <name>`",
    "       — every task names its OWN git worktree, and `needs:` names the tasks",
    "       that must finish first. Then claim again.",
    "5. Delegate ONE worker per successful claim, with EXACTLY this call:",
    "",
    `     ${DELEGATE_SUBAGENT_TOOL_NAME}({`,
    `       subagent_id: "${subagentId}",`,
    "       run_in_background: true,",
    "       claim_id: \"<the claim_id that claim returned>\",",
    `       prompt: "${renderWorkerPrompt(args, f, integrationBranch)}",`,
    "     })",
    "",
    "   claim_id is REQUIRED: it binds the worker's run to its lease, which is how",
    "   Kanna recovers the task if that worker dies. Substitute the task text,",
    "   the worktree and the claim_id the claim returned, and replace",
    "   `<one-line summary of the task you claimed>` inside the leading `[chunk: …]`",
    "   marker with a short name for it. Leave every other word verbatim.",
    "6. If THIS turn began with a task-notification reporting a FAILED run, class",
    "   the failure before you re-delegate:",
    "   - INFRA (AUTH_REQUIRED, CAP_EXCEEDED, DEPTH_EXCEEDED, timeout, spawn",
    "     failure): the work was never attempted, and its lease is released",
    "     automatically. Claim again and do NOT call stop_loop — Kanna disarms the",
    "     loop itself after repeated failures.",
    "   - WORK (the worker ran and could not finish): record it with",
    `     ${APPEND_TRACKING_ROW_TOOL_NAME}({ ${f}, section: "${LOOP_SECTIONS.failedApproaches}", entry: "- <reason>" })`,
    "     then delegate a DIFFERENT approach to the same task.",
    "7. End your turn. Kanna will /clear your context and re-fire this exact prompt",
    `   when a worker completes. Your ONLY durable state is ${trackingFileRel}.`,
    "",
    "HARD RULES (do not violate):",
    "- You are the orchestrator. NEVER edit code yourself: do NOT use Edit, Write,",
    "  MultiEdit, or the Task/Agent tool. Kanna blocks these in loop turns.",
    `- NEVER read the whole ${trackingFileRel} — EXCEPT the single TERMINAL CHECK in`,
    `  step 4(a). Use ${QUERY_TRACKING_FILE_TOOL_NAME} (read),`,
    `  ${APPEND_TRACKING_ROW_TOOL_NAME} and ${REPLACE_TRACKING_SECTION_TOOL_NAME}`,
    "  (write) so the file stays off your context no matter how large it grows.",
    `- NEVER hand-edit the \`[ ]\` / \`[~]\` / \`[x]\` boxes in "${queue}". The claim`,
    "  tools own that state; editing it by hand is how two workers end up in one",
    "  worktree.",
    "- Two workers must NEVER share a worktree. If a task has no `worktree:`, add",
    "  one before claiming it.",
    "- All progress lives in the tracking file, never in your context.",
    "",
    `Goal (for reference): ${goal}`,
    `Verify command: \`${verifyCommand}\``,
    `Work directory: ${workdirRel}`,
    `Integration branch: ${integrationBranch}`,
  ].join("\n")
}
