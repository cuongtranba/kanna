# Agent Teams (SDK Native Multi-Agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Agent SDK native teams in Kanna — the model spawns parallel named teammates via the `Agent` tool; Kanna renders lifecycle live in a per-chat Teams panel + transcript cards; configured claude subagents become spawnable teammate types.

**Architecture:** Upgrade `@anthropic-ai/claude-agent-sdk` 0.2.140 → 0.3.x. SDK driver injects `options.agents` (mapped from settings subagents) and emits new `HarnessEvent {type:"task"}` for `task_*` system messages; coordinator feeds an in-memory `teams-registry`; ws-router pushes a `teams` topic; client mirrors the Workflows panel. Teammate-originated approvals get name attribution.

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/claude-agent-sdk@^0.3.204`, Zustand, colocated `bun test --conditions production`.

**Spec:** `docs/superpowers/specs/2026-07-08-agent-teams-design.md`
**Probe evidence:** `docs/superpowers/specs/2026-07-08-probe-checkpoint.md` + fixtures `scratch/probe-teams/probe-teams-events.jsonl`
**Supersedes plan:** `2026-07-08-managed-agents-multiagent.md` (hosted-API premise dead)

---

## Execution frame (ratified — human-owned, do not edit)

**Objective metrics (only real progress):**
1. Live e2e green on developer's macOS: SDK-driver chat spawns ≥2 parallel teammates, both execute locally, Teams panel updates live, coordinator synthesizes.
2. UI golden path demo of the same via the browser.

**Anti-goals:** (1) Tripwire — `bun run test --conditions production` + `bun run lint` green every commit; SDK/PTY parity tests green. The SDK upgrade task gates on the FULL suite. (2) Drift — pool-token rate-limit lockouts from dev runs; repeated ⇒ pause live runs.

**Flags:** Cannot (upgrade breakage beyond half-day repair budget ⇒ hand up, pin-revert is one line), Breaking (suite/lint/parity red, lockouts), Pointless (panel built but task events never arrive → re-derive from fixtures, don't add tasks). API-key billing remains forbidden; frame changes are human-only.

---

## Verified contracts (do not re-derive)

- `startClaudeSession` internal fn — `src/server/agent.ts:1248`; `query()` options object `:1300-1342` (NO `agents:` today); stream for-await `:945` inside `createClaudeHarnessStream` (`:922`); normalize call site `:1041`
- `normalizeClaudeStreamMessage(message): TranscriptEntry[]` — `agent.ts:681`; already handles `system/task_notification` (`:861` → status entry) and `turn_duration.pendingWorkflowCount` (`:878`); `task_started`/`task_progress`/`task_updated` fall through to `[]` (`:919`)
- `buildCanUseTool` — `agent.ts:1126`; auto-allows all but AskUserQuestion/ExitPlanMode (`:1129`); callback `(toolName, input, options)` reads `options.toolUseID` (`:1134`), ignores `options.agentID`
- `onToolRequest` wiring — `agent.ts:2422`; pending synthesized as `pending_tool_request` entries in `getRecentChatHistory` (`:1918`); client renders via `parseTranscript.ts:261` → `KannaTranscript.tsx:553` → `src/client/components/messages/PendingToolRequestMessage.tsx`
- `buildKannaSystemPromptAppend(subagents, options)` — `src/shared/kanna-system-prompt.ts:93`; `DELEGATION_GUIDANCE` const at `:53`
- `getSubagents` — coordinator-only today (`agent.ts:369`, `:1584`); `startClaudeSession` receives only the rendered `systemPromptAppend`; spawn call-site `startClaudeTurn` `:2805-2831`
- Workflows pattern — store `src/client/stores/workflowsStore.ts` (`byChat` + `setRuns` + `selectRuns` w/ `EMPTY`); WS dispatch `useKannaState.ts:1394`; `WorkflowsSection` props `{runs, onSelectRun, selectedRunId}`; in-chat mount `ChatTranscriptViewport.tsx:370` (listFooter); ws-router topic snapshot `ws-router.ts:953`, command `:2203`
- SDK import surface (upgrade blast radius): `agent.ts` (`query`, `CanUseTool`, `PermissionResult`, `Query`, `SDKUserMessage`), `quick-response.ts` (`query`), `kanna-mcp.ts` (`createSdkMcpServer`, `tool`, `SdkMcpToolDefinition`), `kanna-mcp-http.ts` (type only), `parity-matrix.test.ts` (`Query` type)
- `HarnessEvent` — `src/server/harness-types.ts:3` `{ type: "transcript"|"session_token"|"rate_limit"; ... }`
- Probe fixture event shapes (0.3.204): `task_started {task_id, tool_use_id, description, subagent_type?, name?, model?}`, `task_progress {task_id, description}`, `task_updated {task_id, patch:{status,end_time}}`, `task_notification {task_id, status, output_file}`
- `Subagent` — `src/shared/types.ts:188`; `StatusEntry {kind:"status", status}` — `:1302`

**Conventions:** colocated tests, strong typing (no `any` at boundaries), side-effect seal, stable `EMPTY` client selectors, scope test runs to changed files, commit per green step. UI tasks: apply impeccable + kanna-react-style skills.

---

### Task 1: SDK upgrade 0.2.140 → 0.3.x (tripwire gate)

**Files:**
- Modify: `package.json`
- Modify (compile fixes as needed): `src/server/agent.ts`, `src/server/quick-response.ts`, `src/server/kanna-mcp.ts`, `src/server/kanna-mcp-http.ts`, `src/server/claude-pty/parity-matrix.test.ts`
- Modify: `CLAUDE.md` (billing claim — see step 5)

- [ ] **Step 1: Upgrade**

```bash
bun add @anthropic-ai/claude-agent-sdk@^0.3.204
```

- [ ] **Step 2: Typecheck + inventory breakage**

```bash
bunx tsc --noEmit 2>&1 | head -60
```

Fix every error in the 5 importing files. Known-changed areas at 0.3.x: `SDKMessage` union grew (new system subtypes — additive, no fix needed), check `CanUseTool` third-arg shape (`options.agentID` now present — additive), `query()` options additive. If a symbol was removed/renamed, fix at the import site only.

- [ ] **Step 3: FULL suite + lint (anti-goal tripwire — no scoping on this task)**

```bash
bun run test && bun run lint
```
Expected: green. Red beyond half-day repair budget ⇒ STOP, raise Cannot flag (revert = pin 0.2.140).

- [ ] **Step 4: Smoke a real SDK-driver turn** — start dev server, run one normal Claude chat (SDK driver), confirm transcript works.

- [ ] **Step 5: Verify billing claim** — check the smoke turn ran on the OAuth pool token (no `ANTHROPIC_API_KEY` involved; usage counts against subscription). Fix the stale CLAUDE.md line "SDK mode bills at API rates" to reflect reality as wired (`oauthToken` injection). Same commit.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/server CLAUDE.md
git commit -m "feat(teams): upgrade claude-agent-sdk to 0.3.x"
```

### Task 2: `buildAgentDefinitions` — settings subagents → `options.agents`

**Files:**
- Create: `src/server/teams/agent-definitions.ts`
- Test: `src/server/teams/agent-definitions.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { test, expect } from "bun:test"
import { buildAgentDefinitions, sanitizeAgentKey } from "./agent-definitions"
import type { Subagent } from "../../shared/types"

const sub = (over: Partial<Subagent>): Subagent => ({
  id: "s1", name: "code reviewer", description: "reviews code", provider: "claude",
  model: "claude-sonnet-4-6", modelOptions: {}, systemPrompt: "You review code.",
  contextScope: "previous-assistant-reply", triggerMode: "auto",
  createdAt: 0, updatedAt: 0, ...over,
} as Subagent)

test("maps claude subagent to AgentDefinition keyed by sanitized name", () => {
  const defs = buildAgentDefinitions([sub({})])
  expect(defs["code-reviewer"]).toEqual({
    description: "reviews code",
    prompt: "You review code.",
    model: "claude-sonnet-4-6",
  })
})

test("excludes non-claude subagents", () => {
  expect(buildAgentDefinitions([sub({ provider: "codex" })])).toEqual({})
})

test("empty description falls back to name", () => {
  const defs = buildAgentDefinitions([sub({ description: undefined })])
  expect(defs["code-reviewer"]!.description).toBe("code reviewer")
})

test("duplicate sanitized keys: last updatedAt wins", () => {
  const a = sub({ id: "a", name: "Code Reviewer", updatedAt: 1 })
  const b = sub({ id: "b", name: "code-reviewer", systemPrompt: "B", updatedAt: 2 })
  expect(buildAgentDefinitions([a, b])["code-reviewer"]!.prompt).toBe("B")
})

test("sanitizeAgentKey", () => {
  expect(sanitizeAgentKey("Code Reviewer!")).toBe("code-reviewer")
})
```

- [ ] **Step 2: Run, verify fails**

```bash
bun test --conditions production src/server/teams/agent-definitions.test.ts
```

- [ ] **Step 3: Implement**

```ts
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk"
import type { Subagent } from "../../shared/types"

export function sanitizeAgentKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

export function buildAgentDefinitions(subagents: readonly Subagent[]): Record<string, AgentDefinition> {
  const defs: Record<string, AgentDefinition> = {}
  const claudeSubs = subagents
    .filter((s) => s.provider === "claude")
    .sort((a, b) => a.updatedAt - b.updatedAt)
  for (const s of claudeSubs) {
    const key = sanitizeAgentKey(s.name)
    if (!key) continue
    defs[key] = {
      description: s.description?.trim() ? s.description : s.name,
      prompt: s.systemPrompt,
      model: s.model,
    }
  }
  return defs
}
```

- [ ] **Step 4: Run, verify pass. Commit**

```bash
git add src/server/teams/
git commit -m "feat(teams): map settings subagents to SDK AgentDefinition records"
```

### Task 3: Inject `options.agents` + thread subagents into the driver

**Files:**
- Modify: `src/server/agent.ts` (startClaudeSession args + options + call-site)
- Test: `src/server/agent.test.ts` (extend an existing spawn-args test)

- [ ] **Step 1: Failing test** — follow the existing coordinator tests that inject a fake `startClaudeSession` and assert on received args: assert the fake receives `agentDefinitions` matching `buildAgentDefinitions(getSubagents())` when subagents configured.

- [ ] **Step 2: Implement**
  - Add to `startClaudeSession` args (`agent.ts:1248` block): `agentDefinitions?: Record<string, AgentDefinition>`.
  - In the `query()` options object (before the closing brace at `:1342`): `agents: args.agentDefinitions && Object.keys(args.agentDefinitions).length > 0 ? args.agentDefinitions : undefined,`
  - At the spawn call-site (`startClaudeTurn` `:2805-2831`), for the SDK-driver branch only: `agentDefinitions: buildAgentDefinitions(this.getSubagents())`.
  - Mirror the same field onto `AgentCoordinatorArgs.startClaudeSession` fn type so fakes compile.

- [ ] **Step 3: Run agent tests + lint on changed files. Commit**

```bash
bun test --conditions production src/server/agent.test.ts && bun run lint
git add src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(teams): inject settings subagents as native agents option on SDK spawns"
```

### Task 4: System-prompt division-of-labor guidance

**Files:**
- Modify: `src/shared/kanna-system-prompt.ts`
- Test: `src/shared/kanna-system-prompt.test.ts` (extend)

- [ ] **Step 1: Failing test**

```ts
test("claude subagents add native-team guidance", () => {
  const out = buildKannaSystemPromptAppend([claudeSub], {})
  expect(out).toContain("Agent tool")
  expect(out).toContain("delegate_subagent")
})

test("codex-only roster omits native-team guidance", () => {
  const out = buildKannaSystemPromptAppend([codexSub], {})
  expect(out).not.toContain("native teammate")
})
```

- [ ] **Step 2: Implement** — new const near `DELEGATION_GUIDANCE` (`:53`):

```ts
const NATIVE_TEAM_GUIDANCE = `For claude-provider subagents above you can ALSO spawn them as native teammates with the built-in Agent tool (subagent_type = the subagent's name in kebab-case): use this for parallel fan-out of independent work inside this session — teammates run locally and report lifecycle live. Keep using mcp__kanna__delegate_subagent for codex subagents, keep-alive multi-turn sessions, and anything needing the subagent's own working directory or path policy.`
```

Append to `sections` inside the `subagents.length > 0` block only when at least one `provider === "claude"` subagent exists.

- [ ] **Step 3: Run, pass, commit**

```bash
bun test --conditions production src/shared/kanna-system-prompt.test.ts
git add src/shared/kanna-system-prompt.ts src/shared/kanna-system-prompt.test.ts
git commit -m "feat(teams): system-prompt guidance for native teams vs delegate_subagent"
```

### Task 5: `HarnessEvent` task variant + stream tap

**Files:**
- Modify: `src/server/harness-types.ts`
- Modify: `src/server/agent.ts` (`createClaudeHarnessStream` loop + `normalizeClaudeStreamMessage`)
- Test: `src/server/agent.test.ts` (normalize cases) — follow existing normalize tests

- [ ] **Step 1: Types** — `harness-types.ts`:

```ts
export interface TeamTaskEvent {
  subtype: "task_started" | "task_progress" | "task_updated" | "task_notification"
  taskId: string
  toolUseId?: string
  description?: string
  subagentType?: string
  name?: string
  model?: string
  patch?: { status?: string; end_time?: number }
  status?: string
}

export interface HarnessEvent {
  type: "transcript" | "session_token" | "rate_limit" | "task"
  entry?: TranscriptEntry
  sessionToken?: string
  rateLimit?: { resetAt: number; tz: string }
  task?: TeamTaskEvent
}
```

- [ ] **Step 2: Failing normalize tests** — fixture messages copied from `scratch/probe-teams/probe-teams-events.jsonl`:

```ts
test("task_started -> status entry announcing teammate", () => {
  const entries = normalizeClaudeStreamMessage({
    type: "system", subtype: "task_started",
    task_id: "t1", tool_use_id: "toolu_1", description: "Compute 21*2 with bash", name: "calc",
  })
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ kind: "status", status: expect.stringContaining("calc") })
})

test("task_updated completed -> status entry; task_progress -> no transcript entry", () => {
  expect(normalizeClaudeStreamMessage({ type: "system", subtype: "task_updated", task_id: "t1", patch: { status: "completed" } })[0])
    .toMatchObject({ kind: "status" })
  expect(normalizeClaudeStreamMessage({ type: "system", subtype: "task_progress", task_id: "t1", description: "x" })).toHaveLength(0)
})
```

- [ ] **Step 3: Implement**
  - `normalizeClaudeStreamMessage` (`:861` region): add branches — `task_started` → status `Teammate started: ${name ?? description}`; `task_updated` with `patch.status === "completed" | "failed"` → status `Teammate ${status}: ${task_id short}`; `task_progress` → `[]` (panel-only). `task_notification` branch already exists — leave as is.
  - `createClaudeHarnessStream` loop (after the `:1041` normalize call): for `message.type === "system"` with the four task subtypes, ALSO yield `{ type: "task", task: toTeamTaskEvent(message) }` (small pure mapper in `agent.ts` or `teams/` module).

- [ ] **Step 4: Run, pass. Commit**

```bash
bun test --conditions production src/server/agent.test.ts
git add src/server/harness-types.ts src/server/agent.ts src/server/agent.test.ts
git commit -m "feat(teams): task lifecycle HarnessEvents + transcript status entries"
```

### Task 6: `teams-registry.ts`

**Files:**
- Create: `src/server/teams/teams-registry.ts`
- Test: `src/server/teams/teams-registry.test.ts`

Shared type first — add to `src/shared/types.ts` (client needs it):

```ts
export interface TeamTaskSummary {
  taskId: string
  name?: string
  subagentType?: string
  description: string
  status: "running" | "completed" | "failed"
  model?: string
  startedAt: number
  endedAt?: number
  lastActivityAt: number
}
```

- [ ] **Step 1: Failing tests**

```ts
import { test, expect } from "bun:test"
import { createTeamsRegistry } from "./teams-registry"

const started = { subtype: "task_started" as const, taskId: "t1", description: "Compute", name: "calc", model: "claude-haiku-4-5" }

test("lifecycle: started -> progress -> completed", () => {
  const reg = createTeamsRegistry({ now: () => 100 })
  const seen: string[] = []
  reg.subscribe((chatId) => seen.push(chatId))
  reg.apply("c1", started)
  reg.apply("c1", { subtype: "task_progress", taskId: "t1", description: "running bash" })
  reg.apply("c1", { subtype: "task_updated", taskId: "t1", patch: { status: "completed", end_time: 200 } })
  expect(reg.snapshot("c1")).toEqual([{
    taskId: "t1", name: "calc", subagentType: undefined, description: "Compute",
    status: "completed", model: "claude-haiku-4-5", startedAt: 100, endedAt: 200, lastActivityAt: 100,
  }])
  expect(seen).toEqual(["c1", "c1", "c1"])
})

test("unknown chat -> empty; clear drops; update for unknown task ignored", () => {
  const reg = createTeamsRegistry({ now: () => 1 })
  expect(reg.snapshot("nope")).toEqual([])
  reg.apply("c1", { subtype: "task_updated", taskId: "ghost", patch: { status: "completed" } })
  expect(reg.snapshot("c1")).toEqual([])
  reg.apply("c1", started)
  reg.clear("c1")
  expect(reg.snapshot("c1")).toEqual([])
})
```

- [ ] **Step 2: Run fails. Step 3: Implement** — interface `{ apply(chatId, event: TeamTaskEvent): void; snapshot(chatId): TeamTaskSummary[]; clear(chatId): void; subscribe(cb): () => void }`, in-memory `Map<string, Map<string, TeamTaskSummary>>`, `deps: { now: () => number }`. `task_started` upserts running; `task_progress` bumps `lastActivityAt`; `task_updated.patch.status` maps `"completed"|"failed"`, `end_time` → `endedAt`; `task_notification.status` same mapping (idempotent).

- [ ] **Step 4: Pass. Commit**

```bash
git add src/shared/types.ts src/server/teams/
git commit -m "feat(teams): in-memory per-chat teams registry"
```

### Task 7: Coordinator feed + WS topic `teams`

**Files:**
- Modify: `src/server/agent.ts` (route `type:"task"` HarnessEvents → registry), `src/server/server.ts` (construct + inject), `src/shared/protocol.ts`, `src/server/ws-router.ts`
- Test: `src/server/ws-router.test.ts` (mirror workflows topic tests)

- [ ] **Step 1: Protocol** — topic `{ type: "teams"; chatId: string }`; server message `{ type: "teams"; data: { chatId: string; tasks: TeamTaskSummary[] } }`.
- [ ] **Step 2: Failing ws-router test** — subscribe ⇒ snapshot; registry change ⇒ push (copy the `workflows` test structure at `ws-router` tests).
- [ ] **Step 3: Implement**
  - `AgentCoordinatorArgs.teamsRegistry?: TeamsRegistry`; in the coordinator's harness-stream consumption loop, on `event.type === "task"` call `teamsRegistry.apply(chatId, event.task)`. Clear on chat delete (mirror any existing per-chat cleanup).
  - `server.ts`: `const teamsRegistry = createTeamsRegistry({ now: Date.now })`, pass to coordinator + ws-router deps.
  - `ws-router.ts`: subscribe handler mirrors workflows (`:953` pattern): send snapshot on subscribe; `teamsRegistry.subscribe` push on change.
- [ ] **Step 4: Tests + lint. Commit**

```bash
bun test --conditions production src/server/ws-router.test.ts && bun run lint
git add src/shared/protocol.ts src/server
git commit -m "feat(teams): teams registry feed from harness stream + WS topic"
```

### Task 8: Client store + subscription

**Files:**
- Create: `src/client/stores/teamsStore.ts`
- Modify: `src/client/hooks/useKannaState.ts` (subscribe beside workflows at `:1394`)
- Test: `src/client/stores/teamsStore.test.ts`

- [ ] **Step 1: Failing store test** — `setTasks(chatId, tasks)` updates `byChat`; `selectTasks(chatId)` stable `EMPTY` for unknown chat (two calls, same ref).
- [ ] **Step 2: Implement** — exact copy of `workflowsStore.ts` shape:

```ts
import { create } from "zustand"
import type { TeamTaskSummary } from "../../shared/types"

const EMPTY: TeamTaskSummary[] = []
interface TeamsState {
  byChat: Record<string, TeamTaskSummary[]>
  setTasks(chatId: string, tasks: TeamTaskSummary[]): void
}
export const useTeamsStore = create<TeamsState>()((set) => ({
  byChat: {},
  setTasks: (chatId, tasks) => set((s) => ({ byChat: { ...s.byChat, [chatId]: tasks } })),
}))
export function selectTasks(chatId: string) {
  return (s: TeamsState): TeamTaskSummary[] => s.byChat[chatId] ?? EMPTY
}
```

  - `useKannaState.ts` next to the workflows subscribe (`:1394`): `socket.subscribe({ type: "teams", chatId: activeChatId }, (snapshot) => useTeamsStore.getState().setTasks(snapshot.chatId, snapshot.tasks))`.
- [ ] **Step 3: Pass + `renderForLoopCheck` if selector used in a mounted hook. Commit**

```bash
git add src/client/stores/teamsStore.ts src/client/stores/teamsStore.test.ts src/client/hooks/useKannaState.ts
git commit -m "feat(teams): client teams store + WS subscription"
```

### Task 9: `TeamsSection` panel (impeccable + kanna-react-style skills)

**Files:**
- Create: `src/client/app/TeamsSection.tsx`
- Modify: `src/client/app/ChatTranscriptViewport.tsx` (mount in listFooter beside `WorkflowsSectionWithDetail` at `:370`)
- Test: `src/client/app/TeamsSection.test.tsx`

- [ ] **Step 1: Failing component tests**
  - renders one row per task: name (fallback description), status pill (running/completed/failed), model, elapsed time
  - empty + SDK driver ⇒ discovery hint text `Ask Claude to "use parallel agents"` (UX amendment 3)
  - empty + PTY driver ⇒ hint `Teams live view requires the SDK driver` (UX amendment 1) — driver preference passed as prop
  - hidden entirely when no tasks AND panel collapsed default matches WorkflowsSection behavior
- [ ] **Step 2: Implement** — mirror `WorkflowsSection.tsx` list structure (`<li>` rows + status pill primitives); props:

```ts
export interface TeamsSectionProps {
  tasks: TeamTaskSummary[]
  driverPreference: "sdk" | "pty"
}
```

  Mount in `ChatTranscriptViewport.tsx` listFooter: `<TeamsSection tasks={useTeamsStore(selectTasks(chatId))} driverPreference={...existing settings selector} />`. Reuse existing duration formatter helpers (kanna-react-style: centralized format helpers, tabular numerics).
- [ ] **Step 3: Tests + `renderForLoopCheck` + lint. Verify in browser (dev server): run a teams prompt, watch panel go live.**
- [ ] **Step 4: Commit**

```bash
git add src/client/app/TeamsSection.tsx src/client/app/TeamsSection.test.tsx src/client/app/ChatTranscriptViewport.tsx
git commit -m "feat(teams): live teams panel with driver-aware empty states"
```

### Task 10: Teammate attribution on approval cards (UX amendment 4)

**Files:**
- Modify: `src/server/agent.ts` (`buildCanUseTool` `:1126` — read `options.agentID`; thread onto `HarnessToolRequest`), `src/server/harness-types.ts` (`HarnessToolRequest` + `agentName?`), event-store pending record + `pending_tool_request` synthesis (`agent.ts:1918`), `src/client/lib/parseTranscript.ts:261`, `src/client/components/messages/PendingToolRequestMessage.tsx`
- Test: extend `agent.test.ts` (canUseTool threads agentID) + `PendingToolRequestMessage.test.tsx` (renders prefix)

- [ ] **Step 1: Failing tests** — server: `buildCanUseTool` invoked with `options.agentID = "t1"` produces `HarnessToolRequest` carrying `agentName` resolved via injected `resolveAgentName(taskId)` (wired to `teamsRegistry` lookup: taskId → `name ?? subagentType ?? description`). Client: entry with `agentName: "calc"` renders "calc asks:" prefix.
- [ ] **Step 2: Implement** — smallest threading that reaches the card: `HarnessToolRequest.tool` gains optional `agentName`; `pending_tool_request` synthesis copies it; parseTranscript passes it through; `PendingToolRequestMessage` renders prefix when present. No behavior change when absent.
- [ ] **Step 3: Scoped tests + lint. Commit**

```bash
git commit -am "feat(teams): teammate attribution on approval cards"
```

### Task 11: Live test + docs + C3 change-unit

**Files:**
- Create: `src/server/teams/teams.live.test.ts`
- Modify: `CLAUDE.md`
- C3 change-unit

- [ ] **Step 1: Live test** — productionize the probe (env-gated):

```ts
import { test, expect } from "bun:test"
const token = process.env.KANNA_TEAMS_LIVE_OAUTH_TOKEN
test.skipIf(!token)("native teams: two parallel teammates execute locally", async () => {
  // query() with agents: { echoer: {...} }, prompt asking for parallel calc + echo,
  // collect system/task_started (expect 2) and final result containing "42" and "kanna-team-ok".
  // Copy body from scratch/probe-teams/probe.ts, assert task_started count + result text.
}, 300_000)
```

- [ ] **Step 2: CLAUDE.md** — new "Agent Teams (SDK driver)" section: task-event tap, teams registry/topic/panel, subagents→options.agents mapping, division-of-labor guidance, PTY out of scope, corrected billing statement (if not already fixed in Task 1).
- [ ] **Step 3: C3 change-unit** — `/c3 change`: contract delta c3-210 (task tap + agents injection), new component `teams-registry` (c3-2), client panel delta (c3-1 chat components), kanna-system-prompt delta (c3-3). Same PR.
- [ ] **Step 4: Full gate + objective metrics**

```bash
bun run test && bun run lint
KANNA_TEAMS_LIVE_OAUTH_TOKEN=... bun test --conditions production src/server/teams/teams.live.test.ts
```
Then the UI golden-path demo (objective metric 2): browser, teams prompt, panel live, screenshot.

- [ ] **Step 5: Commit + PR**

```bash
git add -A && git commit -m "docs(teams): live test, CLAUDE.md section, C3 change-unit"
git push -u origin feat/managed-agents-multiagent
gh pr create --repo cuongtranba/kanna --base main --head feat/managed-agents-multiagent --title "feat: Agent SDK native teams — live panel + subagent teammates" --body "..."
```

---

## Self-review notes

- Spec coverage: upgrade (T1), subagent integration (T2/T3), prompt guidance (T4), event tap + transcript cards (T5), registry (T6), WS (T7), store (T8), panel + UX amendments 1/3 (T9), amendment 4 (T10), billing amendment 2 (T1 step 5), live test/docs/C3 (T11). Steering + PTY excluded per spec.
- Types consistent: `TeamTaskEvent` (harness) vs `TeamTaskSummary` (shared/UI) — registry maps former→latter; `selectTasks`/`setTasks` names used in T8/T9.
- Fixture discipline: T5/T6 fixtures come from `scratch/probe-teams/probe-teams-events.jsonl`, per frame.
