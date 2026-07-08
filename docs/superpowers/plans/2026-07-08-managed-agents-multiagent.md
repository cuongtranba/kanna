# Claude Managed Agents (Multi-Agent) Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `claude-managed` provider that runs a Kanna chat as an Anthropic Managed Agents multi-agent session (coordinator + roster synced from Kanna subagents), with tool execution on the local machine via a self-hosted environment worker inside the Kanna server.

**Architecture:** New driver directory `src/server/claude-managed/` beside `claude-pty/`. Control half talks to `api.anthropic.com` through `@anthropic-ai/sdk` (`client.beta.*`, beta header `managed-agents-2026-04-01`) confined to `.adapter.ts` files; pure modules translate SSE events → `HarnessEvent`/`TranscriptEntry`, diff the subagent roster, and run the work-queue claim loop. Threads surface through a registry + WS topic + client panel mirroring the WorkflowsSection pattern. Approvals for `always_ask` tools bridge into the existing durable `ToolCallbackService`.

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/sdk` ^0.81 (new direct dep; already in lockfile transitively), Zustand client stores, colocated `bun test --conditions production`.

**Spec:** `docs/superpowers/specs/2026-07-08-managed-agents-multiagent-design.md`

---

## Execution frame (ratified 2026-07-08 — human-owned, do not edit during execution)

**Objective (direct metrics — the ONLY progress that counts):**
1. Live round-trip test green on the developer's macOS machine: managed chat → coordinator delegates to roster agent → local bash executes in workdir → result streams into transcript.
2. UI golden path: 1 successful multi-agent chat started from the provider picker with the threads panel updating live.

Checked-off tasks are scaffolding, NOT progress. Never report task completion as feature progress; report the two metrics above.

**Anti-goals (the wall):**
1. **Tripwire:** `bun run test --conditions production` + `bun run lint` green at every commit; existing SDK/PTY parity tests untouched and green. Breach ⇒ stop all forward work, fix first.
2. **Drift gauge:** live-API spend during development ≤ $20 (read from Anthropic Console usage after each live run; multi-agent threads parallelize token burn).

**Flags (escalate to human, stop affected work):**
- **Cannot:** Task 4.5 probe fails on macOS AND the raw-REST fallback also fails ⇒ hand up; feature may need a Linux-only gate — human decision.
- **Breaking:** existing test/lint regression, or spend over cap.
- **Pointless:** Tasks 1–15 green (fakes pass) but the live metric stays red ⇒ fakes encoded wrong API assumptions; re-derive fixtures from Task 4.5 probe evidence instead of adding tasks.

**Human-only calls:** scope reduction (multi-agent → single-agent), spend-cap changes, Linux-only fallback, any change to this frame.

**Verified codebase contracts used throughout (do not re-derive):**

- `HarnessEvent` — `src/server/harness-types.ts:3` — `{ type: "transcript" | "session_token" | "rate_limit"; entry?: TranscriptEntry; sessionToken?: string; rateLimit?: {...} }`
- `ClaudeSessionHandle` — `src/server/agent.ts:208` — `{ provider: "claude"; stream: AsyncIterable<HarnessEvent>; interrupt(); close(); sendPrompt(content); setModel(model); setPermissionMode(planMode); getSupportedCommands(); getAccountInfo?() }`
- `TranscriptEntry` variants — `src/shared/types.ts:1514`; `AssistantTextEntry {kind:"assistant_text", text}` (:1250), `StatusEntry {kind:"status", status}` (:1302), `ResultEntry {kind:"result", subtype, isError, durationMs, result}` (:1284), base fields `_id`, `createdAt` (:1086)
- `AgentProvider` = `"claude" | "codex" | "openrouter"` — `src/shared/types.ts:10`
- `Subagent` — `src/shared/types.ts:188` — `{ id, name, description?, provider, model, systemPrompt, ... }`
- `WorkflowRegistry` pattern — `src/server/workflow-registry.ts:36`; WS topic wiring `src/server/ws-router.ts:953` + command at `:2203`
- `ToolCallbackService.submit(args): Promise<ToolCallbackResult>` — `src/server/tool-callback.ts:45`
- Event-store precedent for session-id persistence: `session_token_set` — `src/server/events.ts:241`, applied at `:801`
- Settings CRUD precedent: `customMcpServers` patch — `src/shared/types.ts:940`, reducer `src/server/app-settings.ts:1302`

**Conventions (apply to every task):** colocated tests (`rule-colocated-bun-test`), no `any`/`unknown` at boundaries (`rule-strong-typing`), side-effect seal (IO only in `*.adapter.ts`), stable `EMPTY` refs in client selectors, run only the tests for files you changed (`bun test --conditions production <file>`), commit after each green test.

---

## Phase A — Foundation

### Task 1: Add `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
cd .claude/worktrees/managed-agents && bun add @anthropic-ai/sdk@^0.81.0
```

- [ ] **Step 2: Verify import under Bun**

```bash
bun -e 'import Anthropic from "@anthropic-ai/sdk"; console.log(typeof new Anthropic({ apiKey: "x" }).beta)'
```
Expected: `object`

- [ ] **Step 3: Verify worker helpers import (spike gate)**

```bash
bun -e 'import { EnvironmentWorker, WorkPoller } from "@anthropic-ai/sdk/helpers/beta/environments"; console.log(typeof EnvironmentWorker, typeof WorkPoller)'
```
Expected: `function function`. If this fails under Bun, record the failure in the plan file and use the raw-REST fallback in Task 7 (the fallback path is written into that task).

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "feat(managed): add @anthropic-ai/sdk dependency for Managed Agents API"
```

### Task 2: `managedAgents` settings block

**Files:**
- Modify: `src/shared/types.ts` (AppSettingsSnapshot + patch types)
- Modify: `src/server/app-settings.ts` (normalize + reducer)
- Test: `src/server/app-settings.test.ts` (existing file, add cases)

- [ ] **Step 1: Add shared types** — in `src/shared/types.ts`, next to the `customMcpServers` types:

```ts
export interface ManagedAgentsSettings {
  enabled: boolean
  apiKey: string
  environmentId: string
  environmentKey: string
  lastTest?: { ok: boolean; message: string; testedAt: number }
}

export const DEFAULT_MANAGED_AGENTS_SETTINGS: ManagedAgentsSettings = {
  enabled: false,
  apiKey: "",
  environmentId: "",
  environmentKey: "",
}
```

Add to `AppSettingsSnapshot` (src/shared/types.ts:887 block): `managedAgents: ManagedAgentsSettings`.
Add to `AppSettingsPatch`:

```ts
managedAgents?: Partial<ManagedAgentsSettings>
```

- [ ] **Step 2: Write failing reducer test** — in `src/server/app-settings.test.ts` add:

```ts
test("managedAgents patch merges partial fields and defaults on load", () => {
  const mgr = createTestSettingsManager() // reuse the file's existing helper for constructing AppSettingsManager
  expect(mgr.getSnapshot().managedAgents).toEqual({
    enabled: false, apiKey: "", environmentId: "", environmentKey: "",
  })
  mgr.applyPatch({ managedAgents: { apiKey: "sk-ant-x", enabled: true } })
  expect(mgr.getSnapshot().managedAgents.apiKey).toBe("sk-ant-x")
  expect(mgr.getSnapshot().managedAgents.enabled).toBe(true)
  expect(mgr.getSnapshot().managedAgents.environmentId).toBe("")
})
```

(Adapt helper name to whatever `app-settings.test.ts` already uses for constructing a manager against a temp file — follow the existing tests in that file.)

- [ ] **Step 3: Run test, verify fails**

```bash
bun test --conditions production src/server/app-settings.test.ts
```
Expected: FAIL (`managedAgents` undefined)

- [ ] **Step 4: Implement** — in `src/server/app-settings.ts`:
  - In the snapshot normalizer (where `customModels`/`subagents` are defaulted), add: `managedAgents: { ...DEFAULT_MANAGED_AGENTS_SETTINGS, ...(raw.managedAgents ?? {}) }`.
  - In `applyPatch` (around :1219), add branch:

```ts
if (patch.managedAgents) {
  next.managedAgents = { ...state.managedAgents, ...patch.managedAgents }
}
```

- [ ] **Step 5: Run tests, verify pass; run full app-settings suite**

```bash
bun test --conditions production src/server/app-settings.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/server/app-settings.ts src/server/app-settings.test.ts
git commit -m "feat(managed): managedAgents settings block with defaults + patch merge"
```

### Task 3: `claude-managed` provider in catalog

**Files:**
- Modify: `src/shared/types.ts` (`AgentProvider`, `PROVIDERS`)
- Modify: `src/server/provider-catalog.ts` (no change expected — `SERVER_PROVIDERS = [...PROVIDERS]`)
- Test: `src/server/provider-catalog.test.ts` (add cases)

- [ ] **Step 1: Write failing test**

```ts
test("claude-managed provider resolves models via claude catalog", () => {
  expect(normalizeServerModel("claude-managed", "claude-sonnet-4-6")).toBe("claude-sonnet-4-6")
  expect(normalizeServerModel("claude-managed", undefined)).toBe("claude-sonnet-4-6")
})
```

- [ ] **Step 2: Run, verify fails** (type error: `"claude-managed"` not assignable)

- [ ] **Step 3: Implement**
  - `src/shared/types.ts:10`: `export type AgentProvider = "claude" | "codex" | "openrouter" | "claude-managed"`
  - Add to `PROVIDERS` (after the `"claude"` entry) a `ProviderCatalogEntry`:

```ts
{
  id: "claude-managed",
  label: "Claude Managed",
  defaultModel: "claude-sonnet-4-6",
  supportsPlanMode: false,
  models: CLAUDE_PROVIDER_MODELS, // extract the existing claude entry's models array to a shared const and reuse
  efforts: [],
}
```

  - Extract the claude entry's `models` array literal into `const CLAUDE_PROVIDER_MODELS: ProviderModelOption[] = [...]` and reference from both entries (DRY).

- [ ] **Step 4: Compile + audit union widening.** Run:

```bash
bun run lint 2>&1 | head -50 && bunx tsc --noEmit 2>&1 | head -80
```

Fix every exhaustive-switch / record-keyed-by-provider error the widening surfaces (e.g. provider→label maps in client components, `providerDefaults`). Rule: `claude-managed` reuses claude handling wherever a switch branches on provider for MODEL semantics; it must NOT fall into the SDK/PTY spawn path (that branch is added in Task 11).

- [ ] **Step 5: Run tests**

```bash
bun test --conditions production src/server/provider-catalog.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A src/shared src/server src/client
git commit -m "feat(managed): add claude-managed provider to catalog and AgentProvider union"
```

### Task 4: `managed-types.ts` + `managed-api.adapter.ts`

**Files:**
- Create: `src/server/claude-managed/managed-types.ts`
- Create: `src/server/claude-managed/managed-api.adapter.ts`

No unit test (adapter leaf, exercised by `.live.test.ts` in Task 16); types are compile-checked by consumers.

- [ ] **Step 1: Write `managed-types.ts`** — every wire shape the driver consumes, typed once:

```ts
export type ManagedThreadStatus = "running" | "idle" | "terminated"

export interface ManagedThreadSummary {
  id: string
  agentName: string
  status: ManagedThreadStatus
  parentThreadId: string | null
  createdAt: number
  archivedAt?: number
}

export interface ManagedStopReason {
  type: "end_turn" | "requires_action" | string
  event_ids?: string[]
}

/** Primary-thread SSE event subset the driver consumes. */
export type ManagedSessionEvent =
  | { type: "agent.message"; id: string; content: Array<{ type: string; text?: string }>; session_thread_id?: string }
  | { type: "session.status_idle"; id: string }
  | { type: "session.error"; id: string; error?: { message?: string } }
  | { type: "session.thread_created"; id: string; session_thread_id: string; agent_name: string }
  | { type: "session.thread_status_running"; id: string; session_thread_id: string }
  | { type: "session.thread_status_idle"; id: string; session_thread_id: string; agent_name?: string; stop_reason?: ManagedStopReason }
  | { type: "session.thread_status_terminated"; id: string; session_thread_id: string }
  | { type: "agent.thread_message_received"; id: string; from_session_thread_id: string; from_agent_name: string; content: Array<{ type: string; text?: string }> }
  | { type: "agent.thread_message_sent"; id: string; to_session_thread_id: string; to_agent_name: string; content: Array<{ type: string; text?: string }> }
  | { type: string; id: string } // forward-compat: unknown events are ignored, never crash

export interface ManagedAgentDef {
  id: string
  name: string
  version?: string
}

export interface ManagedApi {
  upsertAgent(input: { name: string; model: string; system: string }): Promise<ManagedAgentDef>
  updateAgent(id: string, input: { name: string; model: string; system: string }): Promise<ManagedAgentDef>
  createCoordinator(input: { name: string; model: string; system: string; rosterIds: string[] }): Promise<ManagedAgentDef>
  updateCoordinator(id: string, input: { name: string; model: string; system: string; rosterIds: string[] }): Promise<ManagedAgentDef>
  createSession(input: { agentId: string; environmentId: string; metadata: Record<string, string> }): Promise<{ id: string }>
  sendUserMessage(sessionId: string, text: string): Promise<void>
  sendInterrupt(sessionId: string, threadId?: string): Promise<void>
  sendToolConfirmation(sessionId: string, toolUseId: string, result: "allow" | "deny"): Promise<void>
  streamEvents(sessionId: string, signal: AbortSignal): AsyncIterable<ManagedSessionEvent>
  listEvents(sessionId: string, afterEventId?: string): Promise<ManagedSessionEvent[]>
  listThreads(sessionId: string): Promise<ManagedThreadSummary[]>
  archiveThread(sessionId: string, threadId: string): Promise<void>
  workStats(environmentId: string): Promise<{ depth: number; pending: number; workersPolling: number }>
}
```

- [ ] **Step 2: Write `managed-api.adapter.ts`** — sole import site of `@anthropic-ai/sdk` for the control half:

```ts
import Anthropic from "@anthropic-ai/sdk"
import type { ManagedApi, ManagedSessionEvent, ManagedThreadSummary } from "./managed-types"

export function createManagedApi(apiKey: string): ManagedApi {
  const client = new Anthropic({ apiKey })
  // Implement each ManagedApi method with the corresponding client.beta.* call:
  //   upsertAgent/updateAgent    -> client.beta.agents.create / client.beta.agents.update
  //   createCoordinator          -> client.beta.agents.create({ tools: [{ type: "agent_toolset_20260401" }],
  //                                   multiagent: { type: "coordinator", agents: rosterIds.map(id => ({ type: "agent", id })) } })
  //   createSession              -> client.beta.sessions.create({ agent, environment_id, metadata })
  //   sendUserMessage            -> client.beta.sessions.events.send(sessionId, { events: [{ type: "user.message", content: [{ type: "text", text }] }] })
  //   sendInterrupt              -> events.send user.interrupt (+ session_thread_id when given)
  //   sendToolConfirmation       -> events.send user.tool_confirmation { tool_use_id, result }
  //   streamEvents               -> client.beta.sessions.events.stream(sessionId) — adapt SDK stream to AsyncIterable<ManagedSessionEvent>, honoring the AbortSignal
  //   listEvents                 -> client.beta.sessions.events.list(sessionId) auto-paginated, mapped to ManagedSessionEvent
  //   listThreads                -> client.beta.sessions.threads.list(sessionId), map to ManagedThreadSummary
  //   archiveThread              -> client.beta.sessions.threads.archive(threadId, { session_id })
  //   workStats                  -> client.beta.environments.work.stats(environmentId)
  // Cast SDK beta payloads at THIS boundary only; everything past this file is ManagedApi-typed.
  ...
}
```

The exact `client.beta` method names must be confirmed against the installed SDK's `.d.ts` (`bun pm ls` then read `node_modules/@anthropic-ai/sdk/resources/beta/`); the docs-verified shapes are in the spec. Any mismatch is fixed HERE, not in consumers.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | grep claude-managed
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/server/claude-managed/managed-types.ts src/server/claude-managed/managed-api.adapter.ts
git commit -m "feat(managed): typed ManagedApi surface + @anthropic-ai/sdk adapter"
```

### Task 4.5: Walking-skeleton probe (DISCOVERY — do not skip, do not defer)

**Purpose:** de-risk every docs-derived assumption before Phase B builds on it. This is a scoped
probe with a budget, not production code. Output is a learning checkpoint, not a feature.

**Files:**
- Create: `scratch/managed-probe.ts` (git-ignored scratch dir; NOT under `src/`, never imported by production code)
- Modify (afterwards): fixture data in Tasks 5–9 tests if real shapes differ from docs

**Budget:** half a day. If blocked past budget ⇒ raise **Cannot** flag to the human, stop.

**Requires from human before starting:** Anthropic API key, Console-created self-hosted environment id + environment key (Console-only generation), exported as `KANNA_MANAGED_LIVE_API_KEY` / `KANNA_MANAGED_LIVE_ENV_ID` / `KANNA_MANAGED_LIVE_ENV_KEY`.

- [ ] **Step 1: Write the probe script** — with real creds, in order:
  1. `client.beta.agents.create` an echo agent (haiku model, system "reply with exactly what you are told to say").
  2. Create a coordinator with `agent_toolset_20260401` + `multiagent` roster = [echo agent].
  3. Start the worker on THIS macOS machine against a tmpdir workdir (SDK helpers path first; note exact imports that resolve).
  4. `client.beta.sessions.create` targeting the self-hosted environment with `metadata: { projectPath: <tmpdir> }`.
  5. Send `user.message`: "delegate to the echo agent, then run `echo kanna-probe-ok` in bash and report the output".
  6. Stream primary-thread events to stdout as raw JSON; save the full event log to `scratch/probe-events.jsonl`.

- [ ] **Step 2: Run it**

```bash
bun scratch/managed-probe.ts | tee scratch/probe-run.log
```

- [ ] **Step 3: Write the learning checkpoint** to `scratch/probe-checkpoint.md`, answering ALL of:
  - Do `@anthropic-ai/sdk` worker helpers run under Bun on macOS? (exact working import paths, or the failure)
  - Does local tool execution work on darwin despite docs saying "Linux host"? (yes/no/partially — evidence)
  - Exact `client.beta.*` method names + request/response shapes actually used (vs Task 4 docs-derived guesses)
  - Real primary-thread event JSON for: `agent.message`, `session.status_idle`, `session.thread_created`, `agent.thread_message_sent/received`, thread `requires_action` (capture at least one of each where possible)
  - Observed spend for the probe run (Console usage read — feeds the $20 drift gauge)

- [ ] **Step 4: Reconcile the plan** — update `managed-types.ts` shapes (Task 4) and the fixture events in Tasks 5, 6, 8, 9 tests to match captured reality. If helpers failed under Bun ⇒ switch Task 7 to its written raw-REST fallback. If macOS execution failed entirely ⇒ STOP, raise **Cannot**, human decides Linux-only gate vs abort.

- [ ] **Step 5: Commit the checkpoint (not the scratch script)**

```bash
git add docs/superpowers/plans/2026-07-08-managed-agents-multiagent.md
git commit -m "docs(managed): walking-skeleton probe checkpoint — reconcile API shapes"
```

---

## Phase B — Pure logic (TDD throughout)

> Gate: Phase B fixture shapes must come from the Task 4.5 probe evidence, not from docs memory.

### Task 5: `agent-sync.ts` — roster diff + coordinator upsert decisions

**Files:**
- Create: `src/server/claude-managed/agent-sync.ts`
- Test: `src/server/claude-managed/agent-sync.test.ts`

Pure module. State (previous sync hashes + remote ids) is persisted by the caller in app settings later; here it's input/output.

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect } from "bun:test"
import { planAgentSync, subagentHash } from "./agent-sync"
import type { Subagent } from "../../shared/types"

const sub = (over: Partial<Subagent>): Subagent => ({
  id: "s1", name: "reviewer", description: "reviews", provider: "claude",
  model: "claude-sonnet-4-6", modelOptions: {}, systemPrompt: "You review code.",
  contextScope: "previous-assistant-reply", triggerMode: "auto",
  createdAt: 0, updatedAt: 0, ...over,
} as Subagent)

test("new subagent -> create action", () => {
  const plan = planAgentSync([sub({})], {})
  expect(plan.actions).toEqual([{ kind: "create", subagent: expect.objectContaining({ id: "s1" }) }])
  expect(plan.coordinatorStale).toBe(true)
})

test("unchanged subagent -> no action, coordinator fresh", () => {
  const s = sub({})
  const prior = { s1: { remoteId: "agent_1", hash: subagentHash(s) } }
  const plan = planAgentSync([s], prior)
  expect(plan.actions).toEqual([])
  expect(plan.coordinatorStale).toBe(false)
  expect(plan.rosterRemoteIds).toEqual(["agent_1"])
})

test("changed prompt -> update action + stale coordinator", () => {
  const s = sub({ systemPrompt: "You review code carefully." })
  const prior = { s1: { remoteId: "agent_1", hash: subagentHash(sub({})) } }
  const plan = planAgentSync([s], prior)
  expect(plan.actions).toEqual([{ kind: "update", remoteId: "agent_1", subagent: expect.objectContaining({ id: "s1" }) }])
  expect(plan.coordinatorStale).toBe(true)
})

test("deleted subagent -> dropped from roster, coordinator stale", () => {
  const prior = { s1: { remoteId: "agent_1", hash: "h" } }
  const plan = planAgentSync([], prior)
  expect(plan.actions).toEqual([])
  expect(plan.rosterRemoteIds).toEqual([])
  expect(plan.coordinatorStale).toBe(true)
})
```

- [ ] **Step 2: Run, verify fails**

```bash
bun test --conditions production src/server/claude-managed/agent-sync.test.ts
```

- [ ] **Step 3: Implement**

```ts
import type { Subagent } from "../../shared/types"

export interface SyncedAgentState { remoteId: string; hash: string }
export type SyncActions =
  | { kind: "create"; subagent: Subagent }
  | { kind: "update"; remoteId: string; subagent: Subagent }
export interface AgentSyncPlan {
  actions: SyncActions[]
  rosterRemoteIds: string[]  // remote ids for UNCHANGED agents; created/updated ids appended by the executor
  coordinatorStale: boolean
}

export function subagentHash(s: Subagent): string {
  return Bun.hash(JSON.stringify([s.name, s.description ?? "", s.model, s.systemPrompt])).toString(16)
}

export function planAgentSync(
  subagents: readonly Subagent[],
  prior: Record<string, SyncedAgentState>,
): AgentSyncPlan {
  const actions: SyncActions[] = []
  const rosterRemoteIds: string[] = []
  let coordinatorStale = false
  const seen = new Set<string>()
  for (const s of subagents) {
    seen.add(s.id)
    const prev = prior[s.id]
    const hash = subagentHash(s)
    if (!prev) { actions.push({ kind: "create", subagent: s }); coordinatorStale = true; continue }
    if (prev.hash !== hash) { actions.push({ kind: "update", remoteId: prev.remoteId, subagent: s }); coordinatorStale = true; continue }
    rosterRemoteIds.push(prev.remoteId)
  }
  for (const id of Object.keys(prior)) if (!seen.has(id)) coordinatorStale = true
  return { actions, rosterRemoteIds, coordinatorStale }
}
```

(Note: managed roster only carries claude-family subagents; the executor in Task 9 filters `provider === "claude"` before calling `planAgentSync` — codex subagents cannot run on the managed control plane.)

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-managed/agent-sync.ts src/server/claude-managed/agent-sync.test.ts
git commit -m "feat(managed): pure roster sync planner with hash diffing"
```

### Task 6: `sse-to-event.ts` — managed events → HarnessEvent

**Files:**
- Create: `src/server/claude-managed/sse-to-event.ts`
- Test: `src/server/claude-managed/sse-to-event.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect } from "bun:test"
import { createManagedEventParser } from "./sse-to-event"
import type { ManagedSessionEvent } from "./managed-types"

const now = () => 1000
const feed = (events: ManagedSessionEvent[]) => {
  const parser = createManagedEventParser({ now })
  return events.flatMap((e) => parser.push(e))
}

test("agent.message text -> assistant_text transcript entry", () => {
  const out = feed([{ type: "agent.message", id: "e1", content: [{ type: "text", text: "hello" }] }])
  expect(out).toHaveLength(1)
  expect(out[0]!.type).toBe("transcript")
  expect(out[0]!.entry).toMatchObject({ kind: "assistant_text", text: "hello" })
})

test("session.status_idle -> result entry ends the turn", () => {
  const out = feed([
    { type: "agent.message", id: "e1", content: [{ type: "text", text: "done" }] },
    { type: "session.status_idle", id: "e2" },
  ])
  expect(out.at(-1)!.entry).toMatchObject({ kind: "result", subtype: "success", isError: false })
})

test("session.error -> error result entry", () => {
  const out = feed([{ type: "session.error", id: "e1", error: { message: "boom" } }])
  expect(out.at(-1)!.entry).toMatchObject({ kind: "result", subtype: "error", isError: true, result: "boom" })
})

test("thread delegation events -> status entries", () => {
  const out = feed([
    { type: "agent.thread_message_sent", id: "e1", to_session_thread_id: "t1", to_agent_name: "reviewer", content: [{ type: "text", text: "review this" }] },
    { type: "agent.thread_message_received", id: "e2", from_session_thread_id: "t1", from_agent_name: "reviewer", content: [{ type: "text", text: "LGTM" }] },
  ])
  expect(out[0]!.entry).toMatchObject({ kind: "status", status: expect.stringContaining("reviewer") })
  expect(out[1]!.entry).toMatchObject({ kind: "status", status: expect.stringContaining("reviewer") })
})

test("duplicate event ids are dropped (reconnect catch-up dedupe)", () => {
  const parser = createManagedEventParser({ now })
  const e: ManagedSessionEvent = { type: "agent.message", id: "e1", content: [{ type: "text", text: "hi" }] }
  expect(parser.push(e)).toHaveLength(1)
  expect(parser.push(e)).toHaveLength(0)
})

test("unknown event types are ignored", () => {
  expect(feed([{ type: "span.something_new", id: "e9" } as ManagedSessionEvent])).toHaveLength(0)
})
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement**

```ts
import type { HarnessEvent } from "../harness-types"
import type { ManagedSessionEvent } from "./managed-types"

export interface ManagedEventParserDeps { now: () => number }
export interface ManagedEventParser {
  push(event: ManagedSessionEvent): HarnessEvent[]
  lastEventId(): string | null
}

const textOf = (content: Array<{ type: string; text?: string }>): string =>
  content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("")

export function createManagedEventParser(deps: ManagedEventParserDeps): ManagedEventParser {
  const seen = new Set<string>()
  let last: string | null = null
  let turnStartedAt = deps.now()
  const entryBase = () => ({ _id: crypto.randomUUID(), createdAt: deps.now() })

  return {
    lastEventId: () => last,
    push(event) {
      if (seen.has(event.id)) return []
      seen.add(event.id)
      last = event.id
      switch (event.type) {
        case "agent.message": {
          const text = textOf(event.content)
          if (!text) return []
          return [{ type: "transcript", entry: { ...entryBase(), kind: "assistant_text", text } }]
        }
        case "session.status_idle":
          return [{ type: "transcript", entry: { ...entryBase(), kind: "result", subtype: "success", isError: false, durationMs: deps.now() - turnStartedAt, result: "" } }]
        case "session.error":
          return [{ type: "transcript", entry: { ...entryBase(), kind: "result", subtype: "error", isError: true, durationMs: deps.now() - turnStartedAt, result: event.error?.message ?? "managed session error" } }]
        case "agent.thread_message_sent":
          return [{ type: "transcript", entry: { ...entryBase(), kind: "status", status: `→ delegated to ${event.to_agent_name}: ${textOf(event.content).slice(0, 200)}` } }]
        case "agent.thread_message_received":
          return [{ type: "transcript", entry: { ...entryBase(), kind: "status", status: `← ${event.from_agent_name} replied: ${textOf(event.content).slice(0, 200)}` } }]
        default:
          return []
      }
    },
  }
}
```

Reset `turnStartedAt` when the driver sends a new `user.message` — export a `beginTurn()` method on the parser (add it plus a test asserting `durationMs` measures from the latest `beginTurn`).

Note: `session.thread_*` events are NOT handled here — they feed the threads registry (Task 8) via a separate tap in the driver.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-managed/sse-to-event.ts src/server/claude-managed/sse-to-event.test.ts
git commit -m "feat(managed): pure managed-event -> HarnessEvent parser with id dedupe"
```

### Task 7: Worker half — `work-poller.ts` + `tool-exec.adapter.ts`

**Files:**
- Create: `src/server/claude-managed/worker/work-poller.ts`
- Create: `src/server/claude-managed/worker/tool-exec.adapter.ts`
- Test: `src/server/claude-managed/worker/work-poller.test.ts`

- [ ] **Step 1: Write failing tests for the claim loop**

```ts
import { test, expect } from "bun:test"
import { createWorkPollerLoop } from "./work-poller"

test("claims work items and dispatches with resolved workdir", async () => {
  const handled: Array<{ sessionId: string; workdir: string }> = []
  const items = [{ workId: "w1", sessionId: "sess_1", metadata: { chatId: "c1", projectPath: "/tmp/proj" } }]
  const loop = createWorkPollerLoop({
    claimNext: async () => items.shift() ?? null,
    handleItem: async (args) => { handled.push({ sessionId: args.sessionId, workdir: args.workdir }) },
    resolveWorkdir: (meta) => meta.projectPath ?? null,
    onError: () => {},
    idleDelayMs: 0,
  })
  await loop.tick()
  expect(handled).toEqual([{ sessionId: "sess_1", workdir: "/tmp/proj" }])
})

test("item with unresolvable workdir is reported, not dispatched", async () => {
  const errors: string[] = []
  const loop = createWorkPollerLoop({
    claimNext: async () => ({ workId: "w1", sessionId: "s", metadata: {} }),
    handleItem: async () => { throw new Error("must not dispatch") },
    resolveWorkdir: () => null,
    onError: (m) => errors.push(m),
    idleDelayMs: 0,
  })
  await loop.tick()
  expect(errors).toHaveLength(1)
})

test("stop() halts the run loop", async () => {
  let polls = 0
  const loop = createWorkPollerLoop({
    claimNext: async () => { polls++; return null },
    handleItem: async () => {},
    resolveWorkdir: () => null,
    onError: () => {},
    idleDelayMs: 1,
  })
  const run = loop.run()
  await new Promise((r) => setTimeout(r, 10))
  loop.stop()
  await run
  expect(polls).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `work-poller.ts`** (pure — all IO injected):

```ts
export interface ClaimedWork {
  workId: string
  sessionId: string
  metadata: Record<string, string>
}
export interface WorkPollerDeps {
  claimNext: () => Promise<ClaimedWork | null>
  handleItem: (args: { workId: string; sessionId: string; workdir: string }) => Promise<void>
  resolveWorkdir: (metadata: Record<string, string>) => string | null
  onError: (message: string) => void
  idleDelayMs: number
}
export interface WorkPollerLoop {
  tick(): Promise<void>
  run(): Promise<void>
  stop(): void
}

export function createWorkPollerLoop(deps: WorkPollerDeps): WorkPollerLoop {
  let stopped = false
  const tick = async () => {
    const work = await deps.claimNext()
    if (!work) return
    const workdir = deps.resolveWorkdir(work.metadata)
    if (!workdir) { deps.onError(`managed work ${work.workId}: no workdir in metadata`); return }
    // Dispatch WITHOUT awaiting completion of the session — a session spans many tool calls;
    // handleItem owns its own lifetime. Errors surface via onError.
    void deps.handleItem({ workId: work.workId, sessionId: work.sessionId, workdir }).catch((e) => deps.onError(String(e)))
  }
  return {
    tick,
    async run() {
      while (!stopped) {
        await tick()
        await new Promise((r) => setTimeout(r, deps.idleDelayMs))
      }
    },
    stop() { stopped = true },
  }
}
```

- [ ] **Step 4: Implement `tool-exec.adapter.ts`** — the SDK-backed IO leaf:

```ts
import Anthropic from "@anthropic-ai/sdk"
// Primary path (verified in Task 1 step 3):
import { WorkPoller } from "@anthropic-ai/sdk/helpers/beta/environments"
import type { ClaimedWork } from "./work-poller"

export interface ManagedWorkerIo {
  claimNext: () => Promise<ClaimedWork | null>
  handleItem: (args: { workId: string; sessionId: string; workdir: string }) => Promise<void>
}

export function createManagedWorkerIo(args: {
  environmentId: string
  environmentKey: string
}): ManagedWorkerIo {
  const client = new Anthropic({ authToken: args.environmentKey })
  // claimNext: one non-blocking poll of the environment work queue
  //   (WorkPoller with blockMs: null / drain, or raw POST /v1/environments/:id/work claim endpoint).
  //   Map claimed item -> { workId, sessionId, metadata } (metadata comes from session create).
  // handleItem: run the toolset for the claimed session with workdir:
  //   const runner = client.beta.sessions.events.tool_runner? — TS name per SDK .d.ts —
  //   using AgentToolContext/setupSkills + betaAgentToolset20260401 from
  //   "@anthropic-ai/sdk/tools/agent-toolset/node" with { workdir }.
  //   Runs until the session's work item completes; posts results back internally.
  // FALLBACK (if Task 1 step 3 failed): implement claimNext/handleItem against the raw
  //   Environments Work REST endpoints (/v1/environments/:id/work claim / ack / stop) with fetch,
  //   executing the six tools (bash/read/write/edit/glob/grep) via Bun primitives — bash through
  //   Bun.spawn(["/bin/bash","-c",cmd],{cwd:workdir}), file tools via node:fs within workdir.
  ...
}
```

Exact helper names/import paths verified against installed `.d.ts` during implementation; mismatches are fixed inside this file only.

- [ ] **Step 5: Run tests, verify pass**

```bash
bun test --conditions production src/server/claude-managed/worker/work-poller.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/server/claude-managed/worker/
git commit -m "feat(managed): work-queue claim loop + local tool execution adapter"
```

### Task 8: `threads-registry.ts`

**Files:**
- Create: `src/server/claude-managed/threads-registry.ts`
- Test: `src/server/claude-managed/threads-registry.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { test, expect } from "bun:test"
import { createManagedThreadsRegistry } from "./threads-registry"

test("thread events build per-chat snapshots and notify subscribers", () => {
  const reg = createManagedThreadsRegistry({ now: () => 5 })
  const seen: string[] = []
  reg.subscribe((chatId) => seen.push(chatId))
  reg.apply("chat1", { type: "session.thread_created", id: "e1", session_thread_id: "t1", agent_name: "reviewer" })
  reg.apply("chat1", { type: "session.thread_status_running", id: "e2", session_thread_id: "t1" })
  expect(reg.snapshot("chat1")).toEqual([
    { id: "t1", agentName: "reviewer", status: "running", parentThreadId: null, createdAt: 5 },
  ])
  expect(seen).toEqual(["chat1", "chat1"])
})

test("terminated status and unknown chat", () => {
  const reg = createManagedThreadsRegistry({ now: () => 5 })
  reg.apply("chat1", { type: "session.thread_created", id: "e1", session_thread_id: "t1", agent_name: "a" })
  reg.apply("chat1", { type: "session.thread_status_terminated", id: "e2", session_thread_id: "t1" })
  expect(reg.snapshot("chat1")[0]!.status).toBe("terminated")
  expect(reg.snapshot("nope")).toEqual([])
})

test("clear(chatId) drops state", () => {
  const reg = createManagedThreadsRegistry({ now: () => 5 })
  reg.apply("chat1", { type: "session.thread_created", id: "e1", session_thread_id: "t1", agent_name: "a" })
  reg.clear("chat1")
  expect(reg.snapshot("chat1")).toEqual([])
})
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement** — plain in-memory map keyed by chatId (fed by the driver's SSE tap, no disk IO, unlike workflow-registry):

```ts
import type { ManagedSessionEvent, ManagedThreadSummary } from "./managed-types"

export interface ManagedThreadsRegistry {
  apply(chatId: string, event: ManagedSessionEvent): void
  snapshot(chatId: string): ManagedThreadSummary[]
  clear(chatId: string): void
  subscribe(cb: (chatId: string) => void): () => void
}

export function createManagedThreadsRegistry(deps: { now: () => number }): ManagedThreadsRegistry {
  const byChat = new Map<string, Map<string, ManagedThreadSummary>>()
  const subs = new Set<(chatId: string) => void>()
  const notify = (chatId: string) => { for (const cb of subs) cb(chatId) }
  return {
    apply(chatId, event) {
      if (!("session_thread_id" in event) || !event.session_thread_id) return
      const threads = byChat.get(chatId) ?? new Map()
      byChat.set(chatId, threads)
      const id = event.session_thread_id
      switch (event.type) {
        case "session.thread_created":
          threads.set(id, { id, agentName: (event as { agent_name: string }).agent_name, status: "idle", parentThreadId: null, createdAt: deps.now() })
          break
        case "session.thread_status_running": {
          const t = threads.get(id); if (t) threads.set(id, { ...t, status: "running" }); break
        }
        case "session.thread_status_idle": {
          const t = threads.get(id); if (t) threads.set(id, { ...t, status: "idle" }); break
        }
        case "session.thread_status_terminated": {
          const t = threads.get(id); if (t) threads.set(id, { ...t, status: "terminated" }); break
        }
        default: return
      }
      notify(chatId)
    },
    snapshot: (chatId) => [...(byChat.get(chatId)?.values() ?? [])],
    clear: (chatId) => { byChat.delete(chatId) },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb) },
  }
}
```

- [ ] **Step 4: Run, verify pass. Commit**

```bash
git add src/server/claude-managed/threads-registry.ts src/server/claude-managed/threads-registry.test.ts
git commit -m "feat(managed): in-memory per-chat threads registry"
```

---

## Phase C — Assembly

### Task 9: `driver.ts` — assemble ClaudeSessionHandle

**Files:**
- Create: `src/server/claude-managed/driver.ts`
- Test: `src/server/claude-managed/driver.test.ts`

- [ ] **Step 1: Define the driver args + write failing test with a fake ManagedApi**

```ts
export interface StartManagedSessionArgs {
  chatId: string
  projectId: string
  localPath: string
  model: string
  initialPrompt?: string
  existingSessionId: string | null       // from event store (resume)
  settings: ManagedAgentsSettings
  subagents: readonly Subagent[]
  syncState: Record<string, SyncedAgentState>          // persisted roster hashes
  persistSyncState: (next: Record<string, SyncedAgentState>, coordinatorId: string) => void
  persistSessionId: (sessionId: string) => void
  api: ManagedApi                         // injected; real impl from managed-api.adapter.ts
  threadsRegistry: ManagedThreadsRegistry
  toolCallback: ToolCallbackService | null
  systemPromptAppend?: string
  now?: () => number
}
export async function startManagedSession(args: StartManagedSessionArgs): Promise<ClaudeSessionHandle>
```

Test (fake `ManagedApi` records calls, emits scripted events):

```ts
test("first spawn syncs roster, creates coordinator + session, streams turn to result", async () => {
  const fake = createFakeManagedApi([
    { type: "agent.message", id: "e1", content: [{ type: "text", text: "hi" }] },
    { type: "session.status_idle", id: "e2" },
  ])
  const handle = await startManagedSession(baseArgs({ api: fake.api, initialPrompt: "go" }))
  const events: HarnessEvent[] = []
  for await (const ev of handle.stream) { events.push(ev); if (events.at(-1)?.entry?.kind === "result") break }
  expect(fake.calls.upsertAgent).toHaveLength(1)          // one claude subagent in baseArgs
  expect(fake.calls.createCoordinator).toHaveLength(1)
  expect(fake.calls.createSession).toHaveLength(1)
  expect(fake.calls.sendUserMessage).toEqual([["go"]])
  expect(events.at(-1)!.entry).toMatchObject({ kind: "result", subtype: "success" })
})

test("resume: existing session id skips creation, sends prompt to same session", async () => { ... assert createSession not called, sendUserMessage hit existing id ... })

test("interrupt() sends user.interrupt", async () => { ... })

test("requires_action idle -> toolCallback.submit, allow -> sendToolConfirmation(allow)", async () => {
  const fake = createFakeManagedApi([
    { type: "session.thread_status_idle", id: "e1", session_thread_id: "t1", agent_name: "reviewer", stop_reason: { type: "requires_action", event_ids: ["toolu_1"] } },
  ])
  const submitted: string[] = []
  const toolCallback = { submit: async (a) => { submitted.push(a.toolUseId); return { status: "answered", decision: { kind: "allow" } } }, ... } as ToolCallbackService
  await startManagedSession(baseArgs({ api: fake.api, toolCallback }))
  await Bun.sleep(0)
  expect(submitted).toEqual(["toolu_1"])
  expect(fake.calls.sendToolConfirmation).toEqual([["toolu_1", "allow"]])
})
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement `driver.ts`.** Responsibilities, in order:
  1. **Sync roster:** filter `subagents` to `provider === "claude"`, run `planAgentSync`, execute actions via `api.upsertAgent`/`api.updateAgent`, then if `coordinatorStale` or no coordinator persisted, `api.createCoordinator`/`api.updateCoordinator` with `{ name: "kanna-coordinator-<projectId>", model, system: systemPromptAppend ?? "", rosterIds }`. Call `persistSyncState`.
  2. **Session:** if `existingSessionId` use it, else `api.createSession({ agentId: coordinatorId, environmentId: settings.environmentId, metadata: { chatId, projectPath: localPath } })` and `persistSessionId`.
  3. **Stream pump:** `AbortController`; async generator that (a) on start, if resuming, calls `api.listEvents(sessionId, lastSeenEventId)` for catch-up then (b) iterates `api.streamEvents(sessionId, signal)`; every event goes through THREE taps: `threadsRegistry.apply(chatId, ev)`, the requires_action bridge (below), and `createManagedEventParser(...).push(ev)` whose `HarnessEvent[]` are yielded. On stream error: reconnect with backoff (3 attempts, 1s/5s/15s), re-entering via `listEvents` catch-up; parser dedupe makes this loss-free.
  4. **Approval bridge:** on `session.thread_status_idle` with `stop_reason.type === "requires_action"`, for each `event_ids[]` entry fire-and-forget: `toolCallback.submit({ chatId, sessionId, toolUseId, toolName: "managed_tool", args: { agentName, threadId }, chatPolicy, cwd: localPath })` → map `decision.kind === "allow" ? "allow" : "deny"` → `api.sendToolConfirmation`. No toolCallback ⇒ auto-deny (fail closed).
  5. **Handle:** return `ClaudeSessionHandle` with `provider: "claude"` per the type — but set `sendPrompt: (c) => { parser.beginTurn(); return api.sendUserMessage(sessionId, c) }`, `interrupt: () => api.sendInterrupt(sessionId)`, `close: () => controller.abort()`, `setModel: async () => {}` (model fixed at coordinator; log a warning), `setPermissionMode: async () => {}` (unsupported), `getSupportedCommands: async () => []`.

- [ ] **Step 4: Run driver tests, verify pass**

```bash
bun test --conditions production src/server/claude-managed/driver.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-managed/driver.ts src/server/claude-managed/driver.test.ts
git commit -m "feat(managed): managed session driver assembling sync, stream, approvals"
```

### Task 10: Event-store persistence (`managed_session_started` + sync state)

**Files:**
- Modify: `src/server/events.ts`
- Test: `src/server/events.test.ts` (add cases)

Session id reuses the existing `session_token_set` machinery — `sessionTokensByProvider` is `Partial<Record<AgentProvider, string|null>>` and now admits the `"claude-managed"` key for free. Only roster sync state needs a new event.

- [ ] **Step 1: Write failing test**

```ts
test("managed_sync_state_set persists roster hashes + coordinator id per project", async () => {
  const store = await createTestStore() // follow existing helper in events.test.ts
  await store.recordManagedSyncState("proj1", { s1: { remoteId: "agent_1", hash: "h1" } }, "coord_1")
  const state = store.getState().managedSyncByProject?.["proj1"]
  expect(state).toEqual({ agents: { s1: { remoteId: "agent_1", hash: "h1" } }, coordinatorId: "coord_1" })
})

test("session_token_set works for claude-managed provider", async () => {
  const store = await createTestStore()
  await store.recordSessionToken("chat1", "claude-managed", "sess_abc")
  expect(store.getState().chats["chat1"]!.sessionTokensByProvider?.["claude-managed"]).toBe("sess_abc")
})
```

- [ ] **Step 2: Run, verify fails**

- [ ] **Step 3: Implement** in `src/server/events.ts`:
  - New variant on `TurnEvent`:

```ts
| {
    v: 1
    type: "managed_sync_state_set"
    timestamp: number
    projectId: string
    agents: Record<string, { remoteId: string; hash: string }>
    coordinatorId: string
  }
```

  - `StoreState`: add `managedSyncByProject: Record<string, { agents: Record<string, { remoteId: string; hash: string }>; coordinatorId: string }>` (initialize `{}`).
  - `applyEvent` case: `state.managedSyncByProject[e.projectId] = { agents: e.agents, coordinatorId: e.coordinatorId }`.
  - Store method `recordManagedSyncState(projectId, agents, coordinatorId)` appending to `turnsLogPath` (mirror `recordSessionToken` at events.ts:1738).

- [ ] **Step 4: Run, verify pass. Commit**

```bash
git add src/server/events.ts src/server/events.test.ts
git commit -m "feat(managed): persist roster sync state + managed session tokens in event store"
```

### Task 11: `agent.ts` + `server.ts` wiring

**Files:**
- Modify: `src/server/agent.ts`
- Modify: `src/server/server.ts`
- Test: `src/server/agent.test.ts` (add case) — follow existing coordinator test setup in that file

- [ ] **Step 1: Extend `AgentAppSettingsView`** (server.ts:106): add `managedAgents: AppSettingsSnapshot["managedAgents"]` and thread it through `buildAgentAppSettingsView`.

- [ ] **Step 2: Add injectable driver fn to `AgentCoordinatorArgs`** (mirror `startClaudeSession` / PTY at agent.ts:1504):

```ts
startManagedSession?: typeof startManagedSession
managedThreadsRegistry?: ManagedThreadsRegistry
```

- [ ] **Step 3: Write failing coordinator test** — provider `"claude-managed"` in `chat.send` routes to the injected `startManagedSession` fake (NOT SDK/PTY), passing `existingSessionId` from the store and persisting the returned session id. Mirror the existing driver-selection tests in `agent.test.ts`.

- [ ] **Step 4: Implement branch** in the spawn path where the coordinator currently picks SDK vs PTY: when `provider === "claude-managed"`:
  - Guard: settings incomplete (`!enabled || !apiKey || !environmentId || !environmentKey`) ⇒ emit an `api_error` transcript entry telling the user to configure Settings → Managed Agents, end the turn.
  - Build args: `api: createManagedApi(settings.apiKey)`, subagents from `this.getSubagents()`, `syncState` + `existingSessionId` from event store, `persistSessionId: (id) => store.recordSessionToken(chatId, "claude-managed", id)`, `persistSyncState: (agents, coordinatorId) => store.recordManagedSyncState(projectId, agents, coordinatorId)`, `toolCallback`, `threadsRegistry`, `systemPromptAppend` (same append the other drivers get).
  - The returned `ClaudeSessionHandle` flows through the SAME turn loop as the other drivers (stream consumption, event-store append, cancel cascade) — no special-casing after spawn.
  - `cancelChat` for managed chats: handle's `interrupt()` already maps to `user.interrupt`; ensure `close()` is called on turn teardown like other drivers.

- [ ] **Step 5: Boot the worker + registry in `server.ts`:**

```ts
const managedThreadsRegistry = createManagedThreadsRegistry({ now: Date.now })
// after appSettings is ready:
const managed = appSettings.getSnapshot().managedAgents
let managedWorker: WorkPollerLoop | null = null
function syncManagedWorker() {
  const s = appSettings.getSnapshot().managedAgents
  const shouldRun = s.enabled && !!s.environmentId && !!s.environmentKey
  if (shouldRun && !managedWorker) {
    const io = createManagedWorkerIo({ environmentId: s.environmentId, environmentKey: s.environmentKey })
    managedWorker = createWorkPollerLoop({
      claimNext: io.claimNext,
      handleItem: io.handleItem,
      resolveWorkdir: (meta) => meta.projectPath ?? null,
      onError: (m) => log.warn(`managed worker: ${m}`),
      idleDelayMs: 1000,
    })
    void managedWorker.run()
  } else if (!shouldRun && managedWorker) {
    managedWorker.stop(); managedWorker = null
  }
}
syncManagedWorker()
appSettings.subscribe(syncManagedWorker) // use the settings manager's existing change-notification hook; if none exists, call syncManagedWorker() from the settings write path in ws-router
```

Pass `managedThreadsRegistry` into both `AgentCoordinator` args and ws-router deps.

- [ ] **Step 6: Run agent tests + lint**

```bash
bun test --conditions production src/server/agent.test.ts && bun run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/server/agent.ts src/server/server.ts src/server/agent.test.ts
git commit -m "feat(managed): route claude-managed chats through managed driver, boot env worker"
```

### Task 12: Protocol + ws-router (threads topic, getThreads, settings test RPC)

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/server/ws-router.ts`
- Test: `src/server/ws-router.test.ts` (add cases following the `workflows` topic tests)

- [ ] **Step 1: Protocol additions** (`src/shared/protocol.ts`, mirror `workflows` at :49):
  - Topic: `{ type: "managed-threads"; chatId: string }`
  - Server message: `{ type: "managed-threads"; data: { chatId: string; threads: ManagedThreadSummary[] } }`
  - Commands: `{ type: "managedThreads.interrupt"; chatId: string; threadId: string }`, `{ type: "managedThreads.archive"; chatId: string; threadId: string }`, `{ type: "settings.testManagedAgents" }` with reply `{ ok: boolean; message: string }`.

- [ ] **Step 2: Failing ws-router tests** — subscribe to `managed-threads` topic ⇒ snapshot message; registry change ⇒ push; `settings.testManagedAgents` with fake api ⇒ persists `lastTest` via settings patch. Follow the existing `workflows` topic test structure in `ws-router.test.ts`.

- [ ] **Step 3: Implement** in `ws-router.ts`:
  - Subscribe handler (mirror workflows at :953): on subscribe send `{ type: "managed-threads", data: { chatId, threads: managedThreadsRegistry?.snapshot(chatId) ?? [] } }`; wire `managedThreadsRegistry.subscribe` to push on change (mirror how workflow registry pushes).
  - `managedThreads.interrupt` / `.archive`: call through a small `ManagedControl` dep injected from server.ts (`{ interrupt(chatId, threadId), archive(chatId, threadId) }`) that the AgentCoordinator implements by delegating to the live driver handle's api (add `getManagedControl(chatId)` on the coordinator; no live session ⇒ no-op with warn).
  - `settings.testManagedAgents`: build `createManagedApi(apiKey).workStats(environmentId)`, reply `{ ok: true, message: "workers polling: N" }` or `{ ok: false, message: <error> }`, persist as `managedAgents.lastTest` settings patch.

- [ ] **Step 4: Run, verify pass. Commit**

```bash
git add src/shared/protocol.ts src/server/ws-router.ts src/server/ws-router.test.ts
git commit -m "feat(managed): managed-threads WS topic, thread commands, connection test RPC"
```

---

## Phase D — Client (use impeccable + kanna-react-style skills for every task here)

### Task 13: Settings card `ManagedAgentsSection`

**Files:**
- Create: `src/client/app/settings/ManagedAgentsSection.tsx`
- Modify: settings page component that renders sections (locate via the component rendering `ModelsSection` / MCP section)
- Test: `src/client/app/settings/ManagedAgentsSection.test.tsx`

- [ ] **Step 1: Failing component test** — renders masked API key input, environment id/key inputs, enable toggle, Test button; typing + save dispatches `managedAgents` settings patch; `lastTest` renders status pill. Follow the MCP servers section test file as the template (same store mocking pattern).
- [ ] **Step 2: Implement** — copy structure of the MCP servers card: text inputs bound to local state, Save applies `AppSettingsPatch { managedAgents: {...} }` over the existing settings write command, Test button sends `settings.testManagedAgents` and renders reply. Include static copy: billing at API rates; tool inputs/outputs transit Anthropic; environment + key created in Anthropic Console (link `https://platform.claude.com/workspaces/default/environments`).
- [ ] **Step 3: Run test, `renderForLoopCheck` on any new selector. Commit**

```bash
git commit -am "feat(managed): settings card for managed agents credentials + connection test"
```

### Task 14: Provider picker gating

**Files:**
- Modify: the client component that renders provider choices (locate via `availableProviders` usage in chat composer/model picker)
- Test: colocated test beside it

- [ ] **Step 1: Failing test** — `claude-managed` hidden when `managedAgents.enabled` false or creds empty; visible when configured.
- [ ] **Step 2: Implement** — filter `availableProviders` entries: drop `claude-managed` unless settings snapshot (already available client-side via the settings store) has `enabled && apiKey && environmentId && environmentKey`.
- [ ] **Step 3: Run, commit**

```bash
git commit -am "feat(managed): gate claude-managed provider behind configured settings"
```

### Task 15: `managedThreadsStore` + `ManagedThreadsSection` panel

**Files:**
- Create: `src/client/stores/managedThreadsStore.ts`
- Create: `src/client/app/ManagedThreadsSection.tsx`
- Modify: chat sidebar component that renders `WorkflowsSection` (render new section beside it)
- Test: `src/client/stores/managedThreadsStore.test.ts`, `src/client/app/ManagedThreadsSection.test.tsx`

- [ ] **Step 1: Failing store test** — `managed-threads` WS message updates per-chat threads; `selectThreads(chatId)` returns stable `EMPTY` ref for unknown chat (copy `workflowsStore.ts` shape exactly):

```ts
const EMPTY: ManagedThreadSummary[] = []
export const selectThreads = (chatId: string) => (s: ManagedThreadsState) => s.byChat[chatId] ?? EMPTY
```

- [ ] **Step 2: Implement store + socket-client wiring** (register the `managed-threads` message type where `workflows` messages are dispatched to `workflowsStore`).
- [ ] **Step 3: Failing component test** — renders one row per thread with agent name + status pill; interrupt button sends `managedThreads.interrupt`; archive button only enabled when status `idle`; thread count shown as `N/25`. Mirror `WorkflowsSection.test.tsx`.
- [ ] **Step 4: Implement `ManagedThreadsSection`** — copy `WorkflowsSection.tsx` layout: collapsible section, row list, status pills reusing existing pill primitives, actions calling the WS commands. Subscribe to the `managed-threads` topic when a `claude-managed` chat is open.
- [ ] **Step 5: `renderForLoopCheck` test on the section. Run all new tests. Commit**

```bash
git commit -am "feat(managed): threads panel with interrupt/archive mirroring workflows section"
```

### Task 16: Live test + docs + C3 change-unit

**Files:**
- Create: `src/server/claude-managed/managed.live.test.ts`
- Modify: `CLAUDE.md`
- C3: change-unit via `c3x`

- [ ] **Step 1: Live test** (env-gated, follows existing `.live.test.ts` convention):

```ts
import { test, expect } from "bun:test"
const key = process.env.KANNA_MANAGED_LIVE_API_KEY
const envId = process.env.KANNA_MANAGED_LIVE_ENV_ID
const envKey = process.env.KANNA_MANAGED_LIVE_ENV_KEY
const enabled = !!key && !!envId && !!envKey

test.skipIf(!enabled)("managed round-trip: agent -> coordinator -> session -> local tool -> result", async () => {
  // createManagedApi(key): upsertAgent(echo agent) -> createCoordinator(roster=[echo]) ->
  // start worker loop against a tmpdir workdir -> createSession(metadata.projectPath=tmpdir) ->
  // sendUserMessage("run `echo kanna-managed-ok` in bash and report output") ->
  // drain streamEvents until result; assert transcript contains "kanna-managed-ok";
  // interrupt + close; assert tmpdir untouched beyond expectations.
}, 300_000)
```

- [ ] **Step 2: CLAUDE.md section** — add "Claude Managed Agents Provider (claude-managed)" documenting: settings block, worker lifecycle, session-id persistence via `session_token_set`, `managed_sync_state_set` event, approval bridge, env of live test, macOS caveat, billing note.
- [ ] **Step 3: C3 change-unit** — `/c3 change`: new component `claude-managed-driver` under c3-2 (peer of c3-225), contract deltas on c3-210 (third driver branch), c3-212 (new provider), c3-116 (settings card). Follow the c3 skill's change reference; docs updated in same PR.
- [ ] **Step 4: Full local gate**

```bash
bun run lint && bun run test
```
Expected: both green.

- [ ] **Step 5: Commit + PR**

```bash
git add -A && git commit -m "docs(managed): live test, CLAUDE.md section, C3 change-unit"
git push -u origin feat/managed-agents-multiagent
gh pr create --repo cuongtranba/kanna --base main --head feat/managed-agents-multiagent --title "feat: Claude Managed Agents multi-agent provider" --body "..."
```

---

## Self-review notes

- Spec coverage: settings (T2/T13), provider (T3/T14), adapter+types (T4), roster sync (T5/T9/T10), SSE→Harness (T6), worker (T7/T11), threads (T8/T12/T15), approvals (T9), persistence/restart (T10/T9 resume), errors (T6 error mapping, T9 reconnect, T11 guard), live test+docs+C3 (T16). Delegation transcript cards implemented as `status` entries in T6 (spec's "delegation cards" v1 rendering rides the existing status renderer; richer cards deferred).
- Known deliberate deviations from spec text: cost display absent (spec: accepted), `setModel`/plan-mode no-ops (managed coordinator model fixed at creation).
- SDK beta method names in T4/T7 are docs-derived; the tasks explicitly instruct verifying against installed `.d.ts` and confining fixes to the adapter files.
