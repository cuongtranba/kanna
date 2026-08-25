// src/server/codex-rollout-line.ts
//
// One rollout JSONL line in, one classified record out. PURE: a string and two
// numbers go in, a value comes out. No IO, no clock, no globals.
//
// THE LINE-INDEX CONTRACT (the reason this signature takes `lineIndex`):
//
//   The caller advances `lineIndex` for EVERY physical line it reads —
//   including blank lines, unparseable JSON, and every dropped record type.
//   `lineIndex` counts lines in the file, never records this function kept.
//
// That is what makes the index a pure function of byte position. MEASURED on
// the reference machine (~950 rollouts, and growing while it was measured):
// `payload.id` is absent on 52% of message/tool records and `ordinal` on 65%
// of all lines. Neither can key a record — the physical line is the only
// universal identity, and it stays stable only if widening the retain table
// below cannot renumber anything already imported.
//
// KEYED OFF `response_item`, DELIBERATELY. `event_msg/item_completed` carries
// the same logical events but appears in only 10 of 875 importable reference
// rollouts — a classifier keyed on it yields an EMPTY transcript for ~99% of
// the corpus. `event_msg` is read here for exactly four things: `token_count`,
// `task_complete`, `turn_aborted`, `thread_settings_applied`.

import { type AnyValue, isRecord } from "../shared/errors"
import type { TokenUsageCounter } from "./codex-app-server-protocol"
import type {
  CodexRolloutRecord,
  CodexSessionMeta,
  CodexTokenInfo,
} from "./codex-session-types"

/**
 * A `role:"user"` message opening with one of these is Codex's own preamble,
 * not something a human typed.
 *
 * MEASURED on the reference machine: of 875 importable rollouts, ZERO begin
 * with human text — 443 open `<recommended_plugins`, 396 `<environment_context`,
 * 36 `# AGENTS.md instructions`. Without this filter every imported chat is
 * titled `<recommended_plugins> Here is a list…` and the first thing the reader
 * sees is a machine preamble.
 *
 * `# AGENTS.md instructions` is matched WITHOUT the trailing ` for ` that the
 * common form carries: some AGENTS.md openers are spelled
 * `# AGENTS.md instructions\n\n<INSTRUCTIONS…`, and the longer prefix misses
 * them entirely.
 */
const SYNTHETIC_USER_PREFIXES: readonly string[] = [
  "<environment_context",
  "<user_instructions",
  "<recommended_plugins",
  "# AGENTS.md instructions",
]

/** True when a `role:"user"` message body is Codex preamble rather than a human turn. */
export function isSyntheticUserText(text: string): boolean {
  const head = text.trimStart()
  return SYNTHETIC_USER_PREFIXES.some((prefix) => head.startsWith(prefix))
}

/**
 * A rollout whose `session_meta` carries any of the three subagent/fork
 * markers duplicates its parent's content and has no parent linkage in the UI.
 * 99 reference rollouts are one of these; the parser refuses them.
 *
 * Tested `!= null`, never `in`: a marker is sometimes absent and sometimes
 * present-and-null, and both mean "not a subagent".
 */
export function isSubagentSessionMeta(meta: CodexSessionMeta): boolean {
  return meta.parentThreadId != null
    || meta.forkedFromId != null
    || meta.agentPath != null
}

function parseJson(raw: string): AnyValue {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function stringOrNull(value: AnyValue): string | null {
  return typeof value === "string" ? value : null
}

/** Trimmed, or `null` for absent / blank — a whitespace summary is no summary. */
function nonBlankOrNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed.length === 0 ? null : trimmed
}

function numberOr(value: AnyValue, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function payloadOf(envelope: Record<string, unknown>): Record<string, unknown> | null {
  const payload = envelope.payload
  return isRecord(payload) ? payload : null
}

/** ISO-8601 (always `…Z` in the corpus) → epoch ms, else the session fallback. */
function timestampOf(envelope: Record<string, unknown>, fallback: number): number {
  const raw = stringOrNull(envelope.timestamp)
  if (raw === null) return fallback
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function textOfContentItems(value: AnyValue): string {
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const text = stringOrNull(entry.text)
    if (text !== null && text.length > 0) parts.push(text)
  }
  return parts.join("")
}

/**
 * `output` is `string | Array<{type:"input_text", text}>` on the wire and BOTH
 * shapes genuinely occur — in the reference corpus 3822 custom outputs are
 * arrays against 568 strings, and 6664 function outputs are strings against
 * 382 arrays. Neither shape is the rare one; flatten both.
 */
function flattenOutput(value: AnyValue): string {
  const asString = stringOrNull(value)
  if (asString !== null) return asString
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const text = stringOrNull(entry.text)
    if (text !== null) parts.push(text)
  }
  return parts.join("")
}

function stringList(value: AnyValue): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const text = stringOrNull(entry)
    if (text !== null) out.push(text)
  }
  return out
}

function tokenCounter(value: AnyValue): TokenUsageCounter | undefined {
  if (!isRecord(value)) return undefined
  const counter: TokenUsageCounter = {}
  const numeric = (raw: AnyValue): number | undefined =>
    typeof raw === "number" && Number.isFinite(raw) ? raw : undefined
  const input = numeric(value.input_tokens ?? value.inputTokens)
  const cached = numeric(value.cached_input_tokens ?? value.cachedInputTokens)
  const output = numeric(value.output_tokens ?? value.outputTokens)
  const reasoning = numeric(value.reasoning_output_tokens ?? value.reasoningOutputTokens)
  const total = numeric(value.total_tokens ?? value.totalTokens)
  if (input !== undefined) counter.input_tokens = input
  if (cached !== undefined) counter.cached_input_tokens = cached
  if (output !== undefined) counter.output_tokens = output
  if (reasoning !== undefined) counter.reasoning_output_tokens = reasoning
  if (total !== undefined) counter.total_tokens = total
  return counter
}

/**
 * `payload.info` reproduced field-by-field rather than passed through, so a
 * rollout field that happens to share a name with something else cannot leak
 * into the app-server-shaped `CodexTokenInfo`.
 */
function tokenInfo(value: AnyValue): CodexTokenInfo | null {
  if (!isRecord(value)) return null
  const info: CodexTokenInfo = {}
  const total = tokenCounter(value.total_token_usage ?? value.total)
  const last = tokenCounter(value.last_token_usage ?? value.last)
  const window = value.model_context_window ?? value.modelContextWindow
  if (total !== undefined) info.total_token_usage = total
  if (last !== undefined) info.last_token_usage = last
  if (typeof window === "number" && Number.isFinite(window)) info.model_context_window = window
  return info
}

function sessionMetaOf(payload: Record<string, unknown>): CodexSessionMeta | null {
  const sessionId = stringOrNull(payload.id) ?? stringOrNull(payload.session_id)
  const cwd = stringOrNull(payload.cwd)
  if (sessionId === null || cwd === null) return null
  return {
    sessionId,
    cwd,
    cliVersion: stringOrNull(payload.cli_version),
    parentThreadId: stringOrNull(payload.parent_thread_id),
    forkedFromId: stringOrNull(payload.forked_from_id),
    agentPath: stringOrNull(payload.agent_path),
  }
}

/**
 * `web_search_call` carries NO top-level `query` in the reference corpus (0 of
 * 9). The query, when there is one, sits at `action.query` / `action.queries`;
 * an `open_page` action has neither and yields "". That is the same fallback
 * chain the live translator's `webSearchQuery` walks.
 */
function webSearchQueryOf(payload: Record<string, unknown>): string {
  const direct = stringOrNull(payload.query)
  if (direct !== null) return direct
  const action = payload.action
  if (!isRecord(action)) return ""
  const fromAction = stringOrNull(action.query)
  if (fromAction !== null) return fromAction
  return stringList(action.queries)[0] ?? ""
}

// ---------------------------------------------------------------------------
// outcomes
// ---------------------------------------------------------------------------

/**
 * Why a physical line produced no record.
 *
 * The three are NOT interchangeable, which is the whole reason this type
 * exists: `classifyRolloutLine` returned a bare `null` for all of them, so an
 * operator with a half-written or disk-corrupted rollout got a transcript
 * missing turns and a green "imported", with nothing anywhere to say so.
 *
 *  - `blank` — whitespace only. Expected; JSONL files end with a newline.
 *  - `unparseable` — the line could NOT be read as a rollout line: bad JSON, a
 *    non-object, a recognized envelope whose `payload` is not an object, or a
 *    retained record type missing a field it cannot be built without
 *    (`session_meta` with no id/cwd, a tool call or output with no `call_id`).
 *    **This is the damage signal.** A caller that counts these has the only
 *    evidence there is that a file was truncated or corrupted.
 *  - `dropped_type` — read cleanly and completely; Kanna deliberately does not
 *    import it (`world_state`, `event_msg/item_completed`, the `developer`
 *    role, a synthetic user preamble, an empty-content message, …). Expected on
 *    a healthy file, in bulk.
 */
/**
 * Openers that mark a rollout as one Codex wrote to ITSELF, not a conversation
 * a person had.
 *
 * Codex runs its own housekeeping through the same rollout machinery, so those
 * runs are indistinguishable from real sessions on disk. MEASURED on the
 * reference machine: of 3916 importable rollouts, **3711 (95%) are the
 * title-generation call alone**, plus 28 session-prep and 28 compaction runs —
 * against roughly a dozen genuine conversations. A bulk import without this
 * filter buries the real sessions under ~3800 five-entry stubs.
 *
 * This has to match on TEXT because nothing structural separates them: the
 * `originator`, `source` and `thread_source` fields on `session_meta` all carry
 * the same values for both kinds (checked across the whole corpus —
 * `thread_source: "user"` would have kept 20 sessions and dropped 129 real
 * ones). Fragile against Codex rewording these prompts, and the failure
 * direction is right: a reworded prompt means noise reappears in a bulk
 * import, never that a real conversation is hidden.
 */
const MACHINE_SESSION_OPENERS = [
  "Generate a short, descriptive title",
  "Analyze the user's instruction for preparing a new coding session",
  "Compact this transcript for reuse in a new coding session",
] as const

/**
 * True when a session's first REAL user message (synthetic preambles already
 * dropped) is one of Codex's own internal prompts.
 *
 * Consulted by the bulk scan only. An explicitly pasted session id is explicit
 * intent and still imports — refusing there would be Kanna overruling a direct
 * instruction.
 */
export function isMachineGeneratedOpener(firstUserText: string): boolean {
  const text = firstUserText.trimStart()
  return MACHINE_SESSION_OPENERS.some((opener) => text.startsWith(opener))
}

export type RolloutLineSkipReason = "blank" | "unparseable" | "dropped_type"

/** One physical line's classification, with the reason kept when there is none. */
export type RolloutLineOutcome =
  | { readonly kind: "record"; readonly record: CodexRolloutRecord }
  | { readonly kind: "skipped"; readonly reason: RolloutLineSkipReason }

function skipped(reason: RolloutLineSkipReason): RolloutLineOutcome {
  return { kind: "skipped", reason }
}

function kept(record: CodexRolloutRecord): RolloutLineOutcome {
  return { kind: "record", record }
}

function classifyResponseItem(
  payload: Record<string, unknown>,
  lineIndex: number,
  timestamp: number,
): RolloutLineOutcome {
  switch (payload.type) {
    case "message": {
      const role = stringOrNull(payload.role)
      // `developer` is the system/skill preamble Codex injects — 940 of 6045
      // messages in the reference corpus. It is never a turn anyone wrote.
      if (role !== "user" && role !== "assistant") return skipped("dropped_type")
      const text = textOfContentItems(payload.content)
      if (text.length === 0) return skipped("dropped_type")
      if (role === "user") {
        if (isSyntheticUserText(text)) return skipped("dropped_type")
        return kept({ kind: "user_message", lineIndex, timestamp, text })
      }
      return kept({ kind: "assistant_message", lineIndex, timestamp, text })
    }
    case "reasoning":
      // `encrypted_content` is deliberately not read; `summary` is empty in
      // every record of the reference corpus but is the only readable half.
      return kept({
        kind: "reasoning",
        lineIndex,
        timestamp,
        summary: stringList(payload.summary),
      })
    case "custom_tool_call": {
      const callId = stringOrNull(payload.call_id)
      const name = stringOrNull(payload.name)
      // A call with no id or no name cannot be built or joined — that is
      // damage, not a type Kanna chose to drop.
      if (callId === null || name === null) return skipped("unparseable")
      return kept({
        kind: "tool_call",
        lineIndex,
        timestamp,
        callId,
        name,
        input: stringOrNull(payload.input) ?? "",
        family: "custom",
      })
    }
    case "function_call": {
      const callId = stringOrNull(payload.call_id)
      const name = stringOrNull(payload.name)
      if (callId === null || name === null) return skipped("unparseable")
      return kept({
        kind: "tool_call",
        lineIndex,
        timestamp,
        callId,
        name,
        input: stringOrNull(payload.arguments) ?? "",
        family: "function",
      })
    }
    case "custom_tool_call_output":
    case "function_call_output": {
      const callId = stringOrNull(payload.call_id)
      if (callId === null) return skipped("unparseable")
      return kept({
        kind: "tool_output",
        lineIndex,
        timestamp,
        callId,
        output: flattenOutput(payload.output),
      })
    }
    case "web_search_call":
      return kept({ kind: "web_search", lineIndex, timestamp, query: webSearchQueryOf(payload) })
    default:
      // `agent_message`, `image_generation_call`, `tool_search_call`,
      // `tool_search_output` — all dropped.
      return skipped("dropped_type")
  }
}

function classifyEventMsg(
  payload: Record<string, unknown>,
  lineIndex: number,
  timestamp: number,
): RolloutLineOutcome {
  switch (payload.type) {
    case "token_count":
      // `info` is null on 175 of 10163 reference records. Carry the null
      // through rather than dropping the record: it still marks the turn
      // boundary a reader sees, and `CodexTokenCountRecord.info` is nullable
      // precisely so `normalizeCodexTokenUsage` is never handed one.
      return kept({ kind: "token_count", lineIndex, timestamp, info: tokenInfo(payload.info) })
    case "task_complete":
      return kept({
        kind: "turn_complete",
        lineIndex,
        timestamp,
        lastAgentMessage: stringOrNull(payload.last_agent_message) ?? "",
        durationMs: numberOr(payload.duration_ms, 0),
      })
    case "turn_aborted":
      return kept({
        kind: "turn_aborted",
        lineIndex,
        timestamp,
        reason: stringOrNull(payload.reason) ?? "",
        durationMs: numberOr(payload.duration_ms, 0),
      })
    case "thread_settings_applied": {
      // The model is NESTED under `thread_settings` here, unlike
      // `turn_context` where it sits directly on the payload. All 240
      // reference records carry exactly `{thread_settings, type}`.
      const settings = payload.thread_settings
      const model = isRecord(settings) ? stringOrNull(settings.model) : null
      return kept({ kind: "model_hint", lineIndex, timestamp, model })
    }
    default:
      // `item_completed`, `agent_message`, `task_started`, `user_message`,
      // `patch_apply_end`, `context_compacted`, `sub_agent_activity`,
      // `web_search_end` — all dropped.
      return skipped("dropped_type")
  }
}

/**
 * Narrow one physical rollout line to the classified union, KEEPING the reason
 * when it produced nothing. PURE.
 *
 * Prefer this over `classifyRolloutLine` in a parser: `unparseable` is the only
 * evidence a rollout was truncated or corrupted, and collapsing it onto the
 * same `null` as a deliberately-dropped `world_state` is what let a damaged
 * file import silently.
 *
 * The caller MUST still advance `lineIndex` for skipped lines — see the
 * line-index contract at the top of this file.
 *
 * `fallbackTimestamp` (epoch ms) is used when the envelope carries no usable
 * `timestamp`; callers pass the session's first timestamp.
 */
export function classifyRolloutLineOutcome(
  rawLine: string,
  lineIndex: number,
  fallbackTimestamp: number,
): RolloutLineOutcome {
  if (rawLine.trim().length === 0) return skipped("blank")
  const parsed = parseJson(rawLine)
  if (!isRecord(parsed)) return skipped("unparseable")

  const timestamp = timestampOf(parsed, fallbackTimestamp)

  switch (parsed.type) {
    case "session_meta": {
      const payload = payloadOf(parsed)
      if (payload === null) return skipped("unparseable")
      const meta = sessionMetaOf(payload)
      // No session id or no cwd: the file names itself a session and then
      // cannot say which. Damage, not a drop.
      if (meta === null) return skipped("unparseable")
      return kept({ kind: "session_meta", lineIndex, timestamp, meta })
    }
    case "turn_context": {
      const payload = payloadOf(parsed)
      if (payload === null) return skipped("unparseable")
      // `session_meta.model_provider` is a PROVIDER id (`cliproxyapi`,
      // `openai`), not a model name — `turn_context.model` and
      // `thread_settings_applied` are the only sources of the latter.
      return kept({ kind: "model_hint", lineIndex, timestamp, model: stringOrNull(payload.model) })
    }
    case "compacted": {
      // `payload.message` ONLY, and by name. `payload.replacement_history` is a
      // full replay of the conversation so far; walking it duplicates the entire
      // transcript while every test still passes, so `CodexCompactedRecord`
      // gives it nowhere to land and this branch never goes near it.
      //
      // A `compacted` line with no readable payload is still a real boundary —
      // it is refused nowhere, it just has no summary.
      const payload = payloadOf(parsed)
      const message = payload === null ? null : stringOrNull(payload.message)
      return kept({ kind: "compacted", lineIndex, timestamp, summary: nonBlankOrNull(message) })
    }
    case "response_item": {
      const payload = payloadOf(parsed)
      if (payload === null) return skipped("unparseable")
      return classifyResponseItem(payload, lineIndex, timestamp)
    }
    case "event_msg": {
      const payload = payloadOf(parsed)
      if (payload === null) return skipped("unparseable")
      return classifyEventMsg(payload, lineIndex, timestamp)
    }
    default:
      // `world_state`, `inter_agent_communication_metadata`, and anything a
      // future Codex adds.
      return skipped("dropped_type")
  }
}

/**
 * `classifyRolloutLineOutcome` with the reason erased.
 *
 * Kept at its original signature so existing callers need no change, but a
 * caller that wants to TELL a corrupt line from an intentional drop — and any
 * parser reporting to a user should — must use the outcome form instead. This
 * one cannot answer that question and never could.
 */
export function classifyRolloutLine(
  rawLine: string,
  lineIndex: number,
  fallbackTimestamp: number,
): CodexRolloutRecord | null {
  const outcome = classifyRolloutLineOutcome(rawLine, lineIndex, fallbackTimestamp)
  return outcome.kind === "record" ? outcome.record : null
}
