import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"

/**
 * A codex rollout JSONL fixture shaped like the real thing on disk
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl`).
 *
 * Every invariant below was chosen because a fixture WITHOUT it lets a broken
 * implementation pass here and then fail on the real corpus, silently. Each
 * one names the production line it protects.
 *
 *  1. **NO `payload.id` and NO `ordinal`, anywhere.** These protect
 *     `CodexRecordBase.lineIndex` (`codex-session-types.ts`) and the
 *     line-index contract at the top of `codex-rollout-line.ts`. Both fields
 *     DO occur in the wild — `ordinal` on 35% of lines, `payload.id` on 48%
 *     of message/tool records — which is exactly the trap: an id-keyed
 *     implementation passes on any fixture carrying them and then storms on
 *     the 52% of real records that have none, because `applyDelta` reads a
 *     record it cannot key as always-new and re-appends the whole transcript
 *     every live-tail tick.
 *
 *  2. **A synthetic `<environment_context>` first user message.** Protects the
 *     `SYNTHETIC_USER_PREFIXES` drop in `classifyRolloutLine`. Of 875
 *     importable reference rollouts, ZERO begin with human text; without the
 *     drop every imported chat title reads `<environment_context> <cwd>…` and
 *     the transcript opens on a machine preamble. A fixture whose first user
 *     line is the human turn cannot catch a missing filter.
 *
 *  3. **A `developer`-role message.** Protects the role check in
 *     `classifyResponseItem`. 940 of 6045 reference messages are `developer`
 *     (system/skill preamble). Kept as its own line rather than folded into
 *     the synthetic case, because the two drops have different causes and a
 *     regression can reintroduce either alone.
 *
 *  4. **A tool call and its output on NON-ADJACENT lines, with a message in
 *     between.** Protects call↔output pairing by `call_id` in
 *     `rolloutToolOutputToThreadItem`. An implementation that pairs by
 *     "the next line" passes on adjacent fixtures and mis-joins every real
 *     transcript, where reasoning and assistant text routinely sit between.
 *
 *  5. **Outputs in BOTH the string and the array shape, across two calls.**
 *     Protects `flattenOutput`. Neither shape is rare in the corpus (3822
 *     array vs 568 string custom outputs; 6664 string vs 382 array function
 *     outputs), so an implementation handling only one loses thousands of tool
 *     results — as empty strings, with no error.
 *
 *  6. **A `compacted` record with a 3-entry `replacement_history`.** Protects
 *     `CodexCompactedRecord` being BARE. `replacement_history` is a full
 *     replay of the conversation; a classifier that walks it duplicates the
 *     entire transcript while every assertion about the records it kept still
 *     passes. The only way to catch that is to put a walkable history in the
 *     fixture and assert the record count did not grow.
 *
 *  7. **A `token_count` with `info: null`.** Protects
 *     `CodexTokenCountRecord.info` being nullable and the record NOT being
 *     dropped. 175 of 10163 reference records carry null; passing one to
 *     `normalizeCodexTokenUsage` throws, and dropping the record loses a turn
 *     boundary.
 *
 *  8. **`session_meta` at line 0 with a REAL `cwd`.** The importer's
 *     `cwdExists()` check refuses a session whose cwd is gone, so callers pass
 *     a directory that actually exists (e.g. one from `mkdtempSync`) or a
 *     brand-new import can never reach `status: "created"`.
 */
export interface CodexRolloutFixture {
  rolloutPath: string
  sessionId: string
  /** Appends one already-shaped envelope. For live-tail delta tests. */
  appendLine: (line: object) => void
}

interface CodexRolloutFixtureOptions {
  sessionId: string
  cwd: string
}

const ISO = (offsetSeconds: number) =>
  new Date(Date.UTC(2026, 5, 7, 6, 0, offsetSeconds)).toISOString()

function envelope(type: string, payload: object, offsetSeconds: number) {
  // NOTE: no `ordinal` key — see invariant 1.
  return { timestamp: ISO(offsetSeconds), type, payload }
}

function writeLines(path: string, lines: object[]) {
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`)
}

function sessionMetaPayload(sessionId: string, cwd: string, extra: object = {}) {
  return {
    id: sessionId,
    timestamp: ISO(0),
    cwd,
    originator: "codex_cli_rs",
    cli_version: "0.58.0",
    // A PROVIDER id, never a model name — the classifier must take the model
    // from `turn_context` / `thread_settings_applied` instead.
    model_provider: "openai",
    ...extra,
  }
}

/**
 * A patch body whose sections are real unified diffs, so `parseApplyPatch`'s
 * `isUnifiedDiff` guard sees what it sees in production.
 */
const APPLY_PATCH_INPUT = [
  "*** Begin Patch",
  "*** Update File: /tmp/demo/notes.md",
  "@@",
  "-old line",
  "+new line",
  "*** End Patch",
].join("\n")

/** Writes an IMPORTABLE rollout: no subagent/fork markers on `session_meta`. */
export function writeCodexRolloutFixture(
  dir: string,
  opts: CodexRolloutFixtureOptions,
): CodexRolloutFixture {
  const { sessionId, cwd } = opts
  mkdirSync(dir, { recursive: true })
  const rolloutPath = join(dir, `rollout-2026-06-07T06-00-00-${sessionId}.jsonl`)

  const lines: object[] = [
    // line 0 — always session_meta
    envelope("session_meta", sessionMetaPayload(sessionId, cwd), 0),
    // line 1 — turn_context: the only readable source of the model name
    envelope("turn_context", { cwd, model: "gpt-5.6-sol", approval_policy: "never" }, 1),
    // line 2 — invariant 2: synthetic first user message
    envelope("response_item", {
      type: "message",
      role: "user",
      content: [{
        type: "input_text",
        text: `<environment_context>\n  <cwd>${cwd}</cwd>\n</environment_context>`,
      }],
    }, 2),
    // line 3 — invariant 3: developer preamble
    envelope("response_item", {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "# Skill: pragmatic\nAlways be terse." }],
    }, 3),
    // line 4 — the real human turn
    envelope("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "rename the note heading" }],
    }, 4),
    // line 5 — reasoning: summary empty, encrypted_content present and never read
    envelope("response_item", {
      type: "reasoning",
      summary: [],
      encrypted_content: "gAAAAABqJQjvCZ1ttREur1XOPW4bnuvo",
    }, 5),
    // line 6 — call A (function family)
    envelope("response_item", {
      type: "function_call",
      name: "exec_command",
      call_id: "call_A",
      arguments: JSON.stringify({ cmd: "cat notes.md", workdir: cwd, yield_time_ms: 1000 }),
    }, 6),
    // line 7 — invariant 4: a message BETWEEN call A and its output
    envelope("response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Reading the file first." }],
    }, 7),
    // line 8 — invariant 5a: output as a STRING
    envelope("response_item", {
      type: "function_call_output",
      call_id: "call_A",
      output: "Process exited with code 0\nOutput:\n# old heading\n",
    }, 8),
    // line 9 — dropped: event_msg/item_completed exists in only 10 of 875 importable
    // rollouts and must never produce an entry
    envelope("event_msg", {
      type: "item_completed",
      item: { id: "item_0", item_type: "command_execution" },
    }, 9),
    // line 10 — call B (custom family, apply_patch)
    envelope("response_item", {
      type: "custom_tool_call",
      status: "completed",
      call_id: "call_B",
      name: "apply_patch",
      input: APPLY_PATCH_INPUT,
    }, 10),
    // line 11 — dropped
    envelope("event_msg", { type: "patch_apply_end", call_id: "call_B", success: true }, 11),
    // line 12 — invariant 5b: output as an ARRAY of input_text parts
    envelope("response_item", {
      type: "custom_tool_call_output",
      call_id: "call_B",
      output: [
        { type: "input_text", text: "Success. Updated the following files:\n" },
        { type: "input_text", text: "M /tmp/demo/notes.md\n" },
      ],
    }, 12),
    // line 13 — invariant 7: token_count with info: null
    envelope("event_msg", { type: "token_count", info: null, rate_limits: null }, 13),
    // line 14 — a populated token_count, snake_case throughout
    envelope("event_msg", {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 13369,
          cached_input_tokens: 2432,
          output_tokens: 11,
          reasoning_output_tokens: 0,
          total_tokens: 13380,
        },
        last_token_usage: {
          input_tokens: 13369,
          cached_input_tokens: 2432,
          output_tokens: 11,
          reasoning_output_tokens: 0,
          total_tokens: 13380,
        },
        model_context_window: 258400,
      },
    }, 14),
    // line 15 — invariant 6: compacted, with a walkable replacement_history
    envelope("compacted", {
      window_id: "w2",
      previous_window_id: "w1",
      first_window_id: "w1",
      window_number: 2,
      message: "Summary of the conversation so far.",
      replacement_history: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "replay one" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "replay two" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "replay three" }] },
      ],
    }, 15),
    // line 16 — dropped
    envelope("world_state", { snapshot: { files: [] } }, 16),
    // line 17 — assistant close
    envelope("response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Heading renamed." }],
    }, 17),
    // line 18
    envelope("event_msg", {
      type: "task_complete",
      turn_id: "turn_1",
      last_agent_message: "Heading renamed.",
      duration_ms: 2899,
    }, 18),
  ]

  writeLines(rolloutPath, lines)

  return {
    rolloutPath,
    sessionId,
    appendLine: (line: object) => {
      appendFileSync(rolloutPath, `${JSON.stringify(line)}\n`)
    },
  }
}

/**
 * The refusal case: a rollout whose `session_meta` carries a NON-NULL
 * `parent_thread_id`. 99 of 534 reference rollouts are a subagent, agent, or
 * fork; they duplicate their parent's content and have no parent linkage in
 * the UI, so `isSubagentSessionMeta` must refuse the file before any of its
 * lines are read.
 */
export function writeSubagentRollout(
  dir: string,
  opts: CodexRolloutFixtureOptions & { parentThreadId?: string },
): CodexRolloutFixture {
  const { sessionId, cwd } = opts
  const parentThreadId = opts.parentThreadId ?? "parent-thread-0001"
  mkdirSync(dir, { recursive: true })
  const rolloutPath = join(dir, `rollout-2026-06-07T06-10-00-${sessionId}.jsonl`)

  const lines: object[] = [
    envelope("session_meta", sessionMetaPayload(sessionId, cwd, {
      parent_thread_id: parentThreadId,
      agent_nickname: "hunter",
      thread_source: "subagent",
    }), 0),
    envelope("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "subagent brief" }],
    }, 1),
    envelope("response_item", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "subagent done" }],
    }, 2),
  ]

  writeLines(rolloutPath, lines)

  return {
    rolloutPath,
    sessionId,
    appendLine: (line: object) => {
      appendFileSync(rolloutPath, `${JSON.stringify(line)}\n`)
    },
  }
}
