import {
  DELEGATE_SUBAGENT_TOOL_NAME,
  STOP_LOOP_TOOL_NAME,
  TASK_CLAIM_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_INTEGRATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_NOTE_TOOL_NAME,
  TASK_SETTLE_TOOL_NAME,
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

function renderWorkerPrompt(args: ParallelPromptArgs, integrationBranch: string): string {
  const { verifyCommand } = args
  return [
    "[chunk: <the subject of the task you claimed>]",
    "Do exactly this task: <task subject from the claim>.",
    "All your work happens in its OWN git worktree at <worktree from the claim>.",
    "Every git call MUST be `git -C <worktree> …` and every path you touch must be",
    "inside that worktree — sibling workers own the other checkouts and editing",
    "theirs corrupts their work.",
    `First, pick up finished dependencies: run \`git -C <worktree> merge ${integrationBranch}\`.`,
    `Verify with \`${verifyCommand}\` run INSIDE <worktree> before you report success`,
    "— do not call run_verify, which checks the integration tree, not yours.",
    "On success: `git -C <worktree> add -A && git -C <worktree> commit -m \\\"<one-line task summary>\\\"`, then call",
    `${TASK_NOTE_TOOL_NAME}({ task_id: \\"<the task id>\\", kind: \\"progress\\", text: \\"<what changed>\\" })`,
    "and then release your lease with",
    `${TASK_SETTLE_TOOL_NAME}({ claim_id: \\"<claim_id>\\", outcome: \\"done\\" })`,
    "On failure: call",
    `${TASK_NOTE_TOOL_NAME}({ task_id: \\"<the task id>\\", kind: \\"failed_approach\\", text: \\"<what you tried and why it failed>\\" })`,
    "and then",
    `${TASK_SETTLE_TOOL_NAME}({ claim_id: \\"<claim_id>\\", outcome: \\"release\\" })`,
    "so the task returns to the plan instead of being lost.",
    "Terminate when done.",
  ].join(" ")
}

export function renderParallelLoopPrompt(args: ParallelPromptArgs): string {
  const { goal, verifyCommand, subagentId, parallelism, workdirRel } = args
  const integrationBranch = args.integrationBranch ?? "HEAD"
  const workdirPhrase = workdirRel === "." ? "the project root" : workdirRel

  return [
    "You are the ORCHESTRATOR of an autonomous PARALLEL loop. You do NOT do the",
    `work yourself — you delegate it to at most ${parallelism} workers at a time.`,
    "Follow these steps EXACTLY every turn:",
    "",
    "1. Integrate finished work BEFORE you claim anything. Call",
    `   ${TASK_INTEGRATE_TOOL_NAME}({})`,
    "   It merges every task branch that is done but not yet integrated into",
    `   ${integrationBranch} and reports any conflict. If it reports one, print`,
    "   \"QUEUE BLOCKED: <the conflict>\", call",
    `   ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN — a conflict between sibling`,
    "   tasks is a plan defect only a human can repair.",
    `2. Read the plan: call ${TASK_LIST_TOOL_NAME}({}). The task list is your ONLY`,
    "   durable state — it survives the /clear between turns, and there is no",
    "   tracking file.",
    `3. Run the verify command (the ORACLE) with Bash, from ${workdirPhrase}:`,
    `   \`${verifyCommand}\`. Check its exit code.`,
    `4. Claim work. Call ${TASK_CLAIM_TOOL_NAME}({}) up to`,
    `   ${parallelism} times. Each call atomically leases ONE task and returns its`,
    "   id, subject, worktree and claim_id — or tells you why nothing was claimable.",
    "   Decide from BOTH the oracle and what the claim reports:",
    "   (a) oracle exited 0 AND the claim reports the plan EXHAUSTED → run the",
    "       TERMINAL CHECK before declaring victory: call",
    `       ${TASK_LIST_TOOL_NAME}({}) with NO status filter and scan EVERY task.`,
    "       Any task still pending or in progress → treat as case (b). Otherwise",
    "       run `git log --oneline -20`",
    `       in ${workdirPhrase} and print a loop-end summary: how many commits were`,
    "       made, what each covers, and what the user should do next. Then print",
    `       "GOAL MET: ${goal}", call ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN.`,
    "   (b) oracle exited 0 BUT the plan still lists real work → print",
    "       \"ORACLE TOO WEAK: <what the plan still lists>\", call",
    `       ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN so a human can tighten it.`,
    "   (c) at least one claim succeeded → go to step 5 and delegate each one.",
    "   (d) the claim reports WAIT — every remaining task is waiting on one a live",
    "       worker still holds → print \"WAIT: <what it is waiting on>\" and END",
    `       THIS TURN. do NOT delegate and do NOT call ${STOP_LOOP_TOOL_NAME}: the`,
    "       worker that finishes will wake you with this prompt again.",
    "   (e) the claim reports QUEUE BLOCKED — nothing claimable and no live worker",
    "       (a dependency cycle, an unknown `needs` id, or a task with no",
    "       worktree) → print \"QUEUE BLOCKED: <the reason it gave>\", call",
    `       ${STOP_LOOP_TOOL_NAME}({}) and END THIS TURN.`,
    "   (f) the oracle failed but the plan is empty → write the next tasks",
    "       yourself, one call each:",
    `       ${TASK_CREATE_TOOL_NAME}({ subject: "<the step>", needs: ["<id>"], worktree: "<path>", branch: "<name>" })`,
    "       — every task names its OWN git worktree, and `needs` names the tasks",
    "       that must finish first. Then claim again.",
    "5. Delegate ONE worker per successful claim, with EXACTLY this call:",
    "",
    `     ${DELEGATE_SUBAGENT_TOOL_NAME}({`,
    `       subagent_id: "${subagentId}",`,
    "       run_in_background: true,",
    "       claim_id: \"<the claim_id that claim returned>\",",
    `       prompt: "${renderWorkerPrompt(args, integrationBranch)}",`,
    "     })",
    "",
    "   claim_id is REQUIRED: it binds the worker's run to its lease, which is how",
    "   Kanna recovers the task if that worker dies. Substitute the task subject,",
    "   its id, the worktree and the claim_id the claim returned, and replace",
    "   `<the subject of the task you claimed>` inside the leading `[chunk: …]`",
    "   marker with a short name for it. Leave every other word verbatim.",
    "6. If THIS turn began with a task-notification reporting a FAILED run, class",
    "   the failure before you re-delegate:",
    "   - INFRA (AUTH_REQUIRED, CAP_EXCEEDED, DEPTH_EXCEEDED, timeout, spawn",
    "     failure): the work was never attempted, and its lease is released",
    "     automatically. Claim again and do NOT call stop_loop — Kanna disarms the",
    "     loop itself after repeated failures.",
    "   - WORK (the worker ran and could not finish): record it with",
    `     ${TASK_NOTE_TOOL_NAME}({ task_id: "<id>", kind: "failed_approach", text: "<reason>" })`,
    "     then delegate a DIFFERENT approach to the same task.",
    "7. End your turn. Kanna will /clear your context and re-fire this exact prompt",
    "   when a worker completes. Your ONLY durable state is the task list.",
    "",
    "HARD RULES (do not violate):",
    "- You are the orchestrator. NEVER edit code yourself: do NOT use Edit, Write,",
    "  MultiEdit, or the Task/Agent tool. Kanna blocks these in loop turns.",
    `- NEVER set a task's status by hand to take or release work. ${TASK_CLAIM_TOOL_NAME}`,
    `  and ${TASK_SETTLE_TOOL_NAME} own lease state; bypassing them is how two`,
    "  workers end up in one worktree.",
    "- Two workers must NEVER share a worktree. If a task has no worktree, give it",
    "  one before claiming it.",
    "- All progress lives in the task list, never in your context.",
    "",
    `Goal (for reference): ${goal}`,
    `Verify command: \`${verifyCommand}\``,
    `Work directory: ${workdirRel}`,
    `Integration branch: ${integrationBranch}`,
  ].join("\n")
}
