# Advisor Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Kanna Claude chat opt into a higher-intelligence advisor model (server-side advisor tool) per chat, via the Claude Agent SDK.

**Architecture:** `advisorModel` is a per-chat field that rides the existing model/effort plumbing from client composer → `chat.send` → `AgentCoordinator` → `startClaudeSession` → SDK `query({ options.settings: { advisorModel } })`. The Agent SDK's `Settings.advisorModel` field wires the `advisor_20260301` server-tool + `advisor-tool-2026-03-01` beta header CLI-internally. SDK driver only; PTY ignores it and the picker shows a hint.

**Tech Stack:** TypeScript, Bun, `@anthropic-ai/claude-agent-sdk` ^0.3.204, React 19, Zustand, shadcn Popover.

**Spec:** `docs/superpowers/specs/2026-07-09-advisor-tool-design.md`

**Test command:** `bun run test` (always `--conditions production`). Single suite: `bun test --conditions production src/server/<file>.test.ts`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/shared/protocol.ts` | WS command shapes | add `advisorModel?` to `chat.send`, `message.enqueue` |
| `src/shared/types.ts` | domain types | add `advisorModel?` to `QueuedChatMessage`; add to client composer prefs types (Task 4) |
| `src/server/agent.ts` | turn lifecycle → SDK spawn | thread `advisorModel` end-to-end; set `query().settings` |
| `src/server/agent.advisor.test.ts` | **new** behavior test | inject fake `startClaudeSession`, assert `advisorModel` reaches SDK spawn (claude) and not codex |
| `src/client/stores/chatPreferencesStore.ts` | per-chat composer state | add `advisorModel` to claude `ComposerState` + persisted shape |
| `src/client/components/chat-ui/ChatPreferenceControls.tsx` | model/provider/effort cluster | advisor picker (impeccable placement, claude-only, PTY hint) |
| `src/client/components/chat-ui/ChatInput.tsx` | composer submit | carry `advisorModel` in `buildSubmitOptions` |
| `src/client/app/useKannaState.ts` | WS send | put `advisorModel` on `chat.send` |
| `.c3/adr/adr-20260709-advisor-tool.md` | change record | ADR-first (Task 0) |

---

## Task 0: C3 ADR (change-op gate)

**Files:**
- Create: `.c3/adr/adr-20260709-advisor-tool.md` (via `c3x`, NOT file tools)

- [ ] **Step 1: Read the ADR schema contract first**

Run:
```bash
C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh schema adr
```
Read the `REJECT IF` block. Every section must be filled to the contract (`N.A - <reason>` only for truly inapplicable rows).

- [ ] **Step 2: Create the ADR**

```bash
C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh add adr advisor-tool --file /tmp/advisor-adr.md
```
Body (write to `/tmp/advisor-adr.md` first) must cover: decision = surface Claude advisor tool per-chat via SDK `settings.advisorModel`; scope = SDK driver only; affected components c3-210 (agent-coordinator), c3-301 (types); Parent Delta = agent-coordinator gains an `advisorModel` spawn arg (no boundary change — it rides existing model plumbing).

- [ ] **Step 3: Transition status and validate**

```bash
C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh set adr-20260709-advisor-tool status accepted
C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh check --include-adr
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add .c3/
git commit -m "docs(c3): ADR for advisor tool"
```

---

## Task 1: Server — thread `advisorModel` to the SDK spawn (TDD)

This is the core. The behavior test drives every server edit below.

**Files:**
- Create: `src/server/agent.advisor.test.ts`
- Modify: `src/shared/protocol.ts:168-181` (chat.send), `:269-279` (message.enqueue)
- Modify: `src/shared/types.ts:92-102` (QueuedChatMessage)
- Modify: `src/server/agent.ts` (multiple sites, listed per step)

- [ ] **Step 1: Write the failing test**

Model the harness on `src/server/agent.openrouter-model.test.ts` (fake `startClaudeSession`, `createFakeStore`, `AsyncEventQueue`, `pushResult`, `waitFor`). Create `src/server/agent.advisor.test.ts`:

```typescript
import { describe, expect, test } from "bun:test"
import { AgentCoordinator } from "./agent"
import { AsyncEventQueue } from "./async-event-queue"
import type { HarnessEvent } from "./harness-types"
import { createFakeStore, waitFor } from "./test-helpers/agent-test-helpers"

function pushResult(events: AsyncEventQueue<HarnessEvent>) {
  events.push({
    type: "transcript",
    entry: {
      _id: "result-1",
      createdAt: Date.now(),
      kind: "result",
      subtype: "success",
      isError: false,
      durationMs: 0,
      result: "done",
    } as never,
  })
}

function makeCoordinator(capture: { advisorModel?: string; seen: boolean }) {
  const events = new AsyncEventQueue<HarnessEvent>()
  const store = createFakeStore()
  const coordinator = new AgentCoordinator({
    store: store as never,
    onStateChange: () => {},
    startClaudeSession: async (args: { advisorModel?: string }) => {
      capture.advisorModel = args.advisorModel
      capture.seen = true
      return {
        provider: "claude",
        stream: events,
        getAccountInfo: async () => null,
        interrupt: async () => {},
        close: () => {},
        setModel: async () => {},
        setPermissionMode: async () => {},
        getSupportedCommands: async () => [],
        sendPrompt: async () => pushResult(events),
      }
    },
  })
  return { coordinator, events }
}

describe("AgentCoordinator advisor tool", () => {
  test("threads advisorModel to the SDK spawn for claude", async () => {
    const capture = { advisorModel: undefined as string | undefined, seen: false }
    const { coordinator } = makeCoordinator(capture)
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-1",
      provider: "claude" as never,
      content: "test",
      model: "claude-sonnet-4-6",
      advisorModel: "claude-opus-4-8",
    })
    await waitFor(() => capture.seen, 4000, "session spawned")
    expect(capture.advisorModel).toBe("claude-opus-4-8")
  }, 10_000)

  test("omits advisorModel when none selected", async () => {
    const capture = { advisorModel: "SENTINEL" as string | undefined, seen: false }
    const { coordinator } = makeCoordinator(capture)
    await coordinator.send({
      type: "chat.send",
      chatId: "chat-2",
      provider: "claude" as never,
      content: "test",
      model: "claude-sonnet-4-6",
    })
    await waitFor(() => capture.seen, 4000, "session spawned")
    expect(capture.advisorModel).toBeUndefined()
  }, 10_000)
})
```

> If `createFakeStore` / `waitFor` are not exported from a shared helper, copy the inline versions from `agent.openrouter-model.test.ts` (top of that file) into this test instead of importing. Verify the exact import path before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/agent.advisor.test.ts`
Expected: FAIL — `advisorModel` is `undefined` in test 1 (field not yet on `chat.send` / not threaded), OR a TS error that `advisorModel` is not a known property.

- [ ] **Step 3: Add the protocol fields**

`src/shared/protocol.ts` — in the `chat.send` shape (after `model?: string`, ~line 176):
```typescript
      model?: string
      advisorModel?: string
```
And in `message.enqueue` (after its `model?: string`, ~line 275):
```typescript
      model?: string
      advisorModel?: string
```

- [ ] **Step 4: Add `advisorModel` to `QueuedChatMessage`**

`src/shared/types.ts:92-102`:
```typescript
export interface QueuedChatMessage {
  id: string
  content: string
  attachments: ChatAttachment[]
  createdAt: number
  provider?: AgentProvider
  model?: string
  advisorModel?: string
  modelOptions?: ModelOptions
  planMode?: boolean
  autoContinue?: { scheduleId: string }
}
```

- [ ] **Step 5: Add `advisorModel` to `SendMessageOptions`**

`src/server/agent.ts:436` (`interface SendMessageOptions`), add beside `model`:
```typescript
  advisorModel?: string
```

- [ ] **Step 6: Return `advisorModel` from `getProviderSettings` (claude branch only)**

`src/server/agent.ts:2236-2244`, add to the claude-branch return object:
```typescript
    if (provider === "claude") {
      const model = normalizeServerModel(provider, options.model, customModels)
      const modelOptions = normalizeClaudeModelOptions(model, options.modelOptions, options.effort, customModels)
      return {
        model: resolveClaudeApiModelId(model, modelOptions.contextWindow),
        effort: modelOptions.reasoningEffort,
        serviceTier: undefined,
        advisorModel: options.advisorModel?.trim() || undefined,
        planMode: catalog.supportsPlanMode ? Boolean(options.planMode) : false,
      }
    }
```
Leave the `openrouter` and `codex` branch returns unchanged (they never set `advisorModel`, so it reads as `undefined` downstream).

- [ ] **Step 7: Add `advisorModel` param to `startTurnForChat` and forward it**

`src/server/agent.ts:2318-2332` — add to the args type (after `effort?: string`):
```typescript
    effort?: string
    advisorModel?: string
```
`startTurnForChat` forwards its args into `startTurnAfterTurnStarted` (find the `startTurnAfterTurnStarted({ args, ... })` call inside `startTurnForChat`; `args` is passed whole, so no per-field edit needed there — just the type widening above).

- [ ] **Step 8: Widen `startTurnAfterTurnStarted` args + forward to `startClaudeTurn`**

`src/server/agent.ts:2500-2515` — add to its `args` object type (after `effort?: string`):
```typescript
      effort?: string
      advisorModel?: string
```
`src/server/agent.ts:2580-2589` — the `this.startClaudeTurn({...})` call, add after `effort: args.effort,`:
```typescript
        model: args.model,
        effort: args.effort,
        advisorModel: args.advisorModel,
        planMode: args.planMode,
```

- [ ] **Step 9: Widen `startClaudeTurn` args + pass to the SDK spawn only**

`src/server/agent.ts:2805-2818` — add to the args type (after `effort?: string`):
```typescript
    effort?: string
    advisorModel?: string
```
`src/server/agent.ts:2912-2944` — the SDK branch `this.startClaudeSessionFn({...})`, add after `effort: args.effort,` (~line 2916):
```typescript
              model: args.model,
              effort: args.effort,
              advisorModel: args.advisorModel,
              planMode: args.planMode,
```
**Do NOT add it to the PTY branch** `this.startClaudeSessionPTYFn({...})` at ~2882 — advisor is SDK-only.

- [ ] **Step 10: Add `advisorModel` param to `startClaudeSession` + wire `query().settings`**

`src/server/agent.ts:1340-1388` — add to the args object type (after `effort?: string`, ~line 1344):
```typescript
  effort?: string
  advisorModel?: string
```
`src/server/agent.ts:1401-1444` — inside `query({ options: {...} })`, add a `settings` field (place it beside `settingSources`, ~line 1440):
```typescript
      settingSources: ["user", "project", "local"],
      ...(args.advisorModel ? { settings: { advisorModel: args.advisorModel } } : {}),
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `bun test --conditions production src/server/agent.advisor.test.ts`
Expected: PASS (both tests).

- [ ] **Step 12: Commit**

```bash
git add src/shared/protocol.ts src/shared/types.ts src/server/agent.ts src/server/agent.advisor.test.ts
git commit -m "feat(server): thread advisorModel to SDK query settings"
```

---

## Task 2: Server — persist `advisorModel` through the queued-message path

When a turn is already running, `chat.send` queues the message; on dequeue it re-derives settings from the stored `QueuedChatMessage`. Without this, a queued send loses its advisor.

**Files:**
- Modify: `src/server/agent.ts:2269-2280` (`enqueueMessage`), `:3081-3087` (proactive-compact enqueue)
- Modify: `src/server/agent.advisor.test.ts` (add queued-path test)

- [ ] **Step 1: Write the failing test**

Append to `src/server/agent.advisor.test.ts`. Mirror the "spawns while active → queue → dequeue" pattern from `agent.openrouter-model.test.ts` if it has one; otherwise assert the stored queued message carries `advisorModel` by inspecting the fake store. Minimal version:

```typescript
test("persists advisorModel on the queued message", async () => {
  const capture = { advisorModel: undefined as string | undefined, seen: false }
  const { coordinator } = makeCoordinator(capture)
  // First send starts a turn; second send (same chat, turn active) queues.
  await coordinator.send({
    type: "chat.send", chatId: "chat-3", provider: "claude" as never,
    content: "first", model: "claude-sonnet-4-6", advisorModel: "claude-opus-4-8",
  })
  const queued = await coordinator.enqueue({
    type: "message.enqueue", chatId: "chat-3",
    content: "queued", model: "claude-sonnet-4-6", advisorModel: "claude-opus-4-7",
  } as never)
  // Assert the stored queued message kept advisorModel.
  const stored = (coordinator as never as { store: { getQueuedMessages(id: string): Array<{ advisorModel?: string }> } })
    .store.getQueuedMessages("chat-3")
  expect(stored.some((m) => m.advisorModel === "claude-opus-4-7")).toBe(true)
}, 10_000)
```

> Adjust the enqueue entry point to whatever the coordinator exposes for `message.enqueue` (check `coordinator.send` vs a dedicated `enqueue` method near line 3040). If only `send` exists, drive both sends through it and rely on the second being queued because the first turn is still active.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --conditions production src/server/agent.advisor.test.ts`
Expected: FAIL — stored queued message has `advisorModel === undefined` (not passed to `store.enqueueMessage`).

- [ ] **Step 3: Pass `advisorModel` in `enqueueMessage`**

`src/server/agent.ts:2269-2280`:
```typescript
  private async enqueueMessage(chatId: string, content: string, attachments: ChatAttachment[], options?: SendMessageOptions) {
    const queued = await this.store.enqueueMessage(chatId, {
      content,
      attachments,
      provider: options?.provider,
      model: options?.model,
      advisorModel: options?.advisorModel,
      modelOptions: options?.modelOptions,
      planMode: options?.planMode,
      autoContinue: options?.autoContinue,
    })
```
(The store's `enqueueMessage` accepts `Omit<QueuedChatMessage, ...>`, so the field flows automatically now that Task 1 added it to `QueuedChatMessage`.)

- [ ] **Step 4: Pass `advisorModel` in the proactive-compact enqueue**

`src/server/agent.ts:3081-3087`:
```typescript
      const queuedMessage = await this.enqueueMessage(chatId, command.content, command.attachments ?? [], {
        provider: command.provider,
        model: command.model,
        advisorModel: command.advisorModel,
        modelOptions: command.modelOptions,
        effort: command.effort,
        planMode: command.planMode,
      })
```

- [ ] **Step 5: Verify dequeue forwards it (read-only check, no edit expected)**

Confirm `dequeueAndStartQueuedMessage` (`:2283-2306`) calls `getProviderSettings(provider, queuedMessage)` then `startTurnForChat({ ..., advisorModel: settings.advisorModel })`. Since `queuedMessage` now has `advisorModel` and `getProviderSettings` reads `options.advisorModel`, add the forward at `:2293-2305`:
```typescript
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      advisorModel: settings.advisorModel,
      planMode: settings.planMode,
```

- [ ] **Step 6: Forward `advisorModel` in the two `chat.send` `startTurnForChat` calls**

`src/server/agent.ts:3088-3101` (proactive-compact `/compact` turn — this turn is the synthetic compact, keep advisor so the real turn behind it inherits nothing extra; still forward for consistency) and `:3117-3128` (normal path). In BOTH `startTurnForChat({...})` calls add after `effort: settings.effort,`:
```typescript
      model: settings.model,
      effort: settings.effort,
      serviceTier: settings.serviceTier,
      advisorModel: settings.advisorModel,
      planMode: settings.planMode,
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test --conditions production src/server/agent.advisor.test.ts`
Expected: PASS (all tests, including test 1 from Task 1 still green — it goes through the `:3117` path).

- [ ] **Step 8: Commit**

```bash
git add src/server/agent.ts src/server/agent.advisor.test.ts
git commit -m "feat(server): persist advisorModel across queued sends"
```

---

## Task 3: Server — force respawn when advisor changes mid-chat

The Claude session is reused across turns unless a key changes (`:2821-2827`). If the user changes the advisor between turns, the warm session must respawn or the change is ignored.

**Files:**
- Modify: `src/server/agent.ts:2819-2827` (reuse guard), `:2954-2969` (session record), and the `ClaudeSession` interface (find via the `this.claudeSessions` map type — search `interface ClaudeSession` / `claudeSessions = new Map`).

- [ ] **Step 1: Locate the `ClaudeSession` record type**

Run: `grep -n "claudeSessions\b\|interface ClaudeSession\|ClaudeSession =" src/server/agent.ts`
Identify the record type that holds `model`, `effort`, `planMode`, `localPath`.

- [ ] **Step 2: Add `advisorModel` to the session record type**

In that interface, beside `effort?: string`:
```typescript
  advisorModel?: string
```

- [ ] **Step 3: Include `advisorModel` in the reuse guard**

`src/server/agent.ts:2821-2827`, add a clause:
```typescript
    if (
      !session ||
      session.localPath !== args.localPath ||
      session.effort !== args.effort ||
      session.advisorModel !== args.advisorModel ||
      args.forkSession ||
      session.additionalDirectories.join("|") !== (args.additionalDirectories ?? []).join("|")
    ) {
```

- [ ] **Step 4: Store `advisorModel` on the new session record**

`src/server/agent.ts:2954-2969`, add beside `effort: args.effort,`:
```typescript
        model: args.model,
        effort: args.effort,
        advisorModel: args.advisorModel,
        planMode: args.planMode,
```

- [ ] **Step 5: Add the respawn test**

Append to `src/server/agent.advisor.test.ts`: send turn 1 with `advisorModel: "claude-opus-4-8"`, let it finish (push result), send turn 2 with `advisorModel: "claude-opus-4-7"`, assert the fake `startClaudeSession` was called twice with the two different advisor models. Track calls in an array in the capture object.

- [ ] **Step 6: Run + verify pass**

Run: `bun test --conditions production src/server/agent.advisor.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/agent.ts src/server/agent.advisor.test.ts
git commit -m "feat(server): respawn claude session when advisor changes"
```

---

## Task 4: Client — persist advisor selection in composer state

**Files:**
- Modify: `src/client/stores/chatPreferencesStore.ts:30-47` (`ComposerState`), and the persisted/legacy shapes (`:52-110`) + `ChatProviderPreferences`/`ProviderPreference` in `src/shared/types.ts` claude variant.
- Modify: `src/client/stores/chatPreferencesStore.test.ts`

- [ ] **Step 1: Write the failing test**

In `chatPreferencesStore.test.ts`, add: set composer state for a chat with `provider:"claude", advisorModel:"claude-opus-4-8"`, read it back, assert `advisorModel` persists; assert switching provider to codex and back does not leak advisor onto codex state.

- [ ] **Step 2: Run to verify fail**

Run: `bun test --conditions production src/client/stores/chatPreferencesStore.test.ts`
Expected: FAIL — `advisorModel` not a known field / not persisted.

- [ ] **Step 3: Add `advisorModel` to the claude `ComposerState` + shared prefs**

`src/client/stores/chatPreferencesStore.ts:30-36`:
```typescript
export type ComposerState =
  | {
    provider: "claude"
    model: string
    advisorModel?: string
    modelOptions: ClaudeModelOptions
    planMode: boolean
  }
```
Mirror the field in the persisted claude variants (`PersistedComposerState`, legacy shapes at `:52-110`) and in `src/shared/types.ts` `ProviderPreference` / `ChatProviderPreferences` claude variant (search those names). Only the claude variant gets `advisorModel`.

- [ ] **Step 4: Run to verify pass**

Run: `bun test --conditions production src/client/stores/chatPreferencesStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/stores/chatPreferencesStore.ts src/client/stores/chatPreferencesStore.test.ts src/shared/types.ts
git commit -m "feat(client): persist advisorModel in composer state"
```

---

## Task 5: Client — carry advisorModel through submit → WS send

**Files:**
- Modify: `src/client/components/chat-ui/ChatInput.tsx:714-729` (`buildSubmitOptions`)
- Modify: `src/client/app/useKannaState.ts:1930-1941` (`chat.send`) and the send-options type it consumes (`:594-608` region)

- [ ] **Step 1: Add advisorModel to `buildSubmitOptions`**

`src/client/components/chat-ui/ChatInput.tsx:723-728`:
```typescript
    return {
      provider: selectedProvider,
      model: providerPrefs.model,
      advisorModel: selectedProvider === "claude" ? providerPrefs.advisorModel : undefined,
      modelOptions,
      planMode: showPlanMode ? providerPrefs.planMode : false,
    }
```
(`providerPrefs` is the claude composer state here; `advisorModel` is now typed on it from Task 4.)

- [ ] **Step 2: Put advisorModel on the `chat.send` command**

`src/client/app/useKannaState.ts:1930-1941`, add after `model: options?.model,`:
```typescript
        model: options?.model,
        advisorModel: options?.advisorModel,
        modelOptions: options?.modelOptions,
```
Widen the `options` type of the enclosing `sendMessage`/`onSubmit` to include `advisorModel?: string` (follow the same declaration `model?: string` lives in).

- [ ] **Step 3: Typecheck**

Run: `bun run lint`
Expected: no errors, no new warnings (cap is a ratchet).

- [ ] **Step 4: Commit**

```bash
git add src/client/components/chat-ui/ChatInput.tsx src/client/app/useKannaState.ts
git commit -m "feat(client): send advisorModel with chat.send"
```

---

## Task 6: Client — advisor picker UI (impeccable)

**Files:**
- Modify: `src/client/components/chat-ui/ChatPreferenceControls.tsx` (advisor picker), and pass `onAdvisorModelChange` + `advisorModel` props from `ChatInput.tsx`.

- [ ] **Step 1: Invoke the impeccable skill for placement**

Use the `impeccable` skill to decide picker placement (inline second dropdown vs nested in model popover), styling, label, and the PTY hint / claude-only visibility. Produce a concrete placement decision and show the user a preview before finalizing (per the user's earlier choice "Let you decide (Impeccable)").

- [ ] **Step 2: Add the advisor picker**

Reuse the existing `SearchableModelPopover` (`:161-232`). Render it only when `selectedProvider === "claude"`. Model list = the same claude entries already passed as `availableProviders` (the claude provider's `models`). Prepend a `{ id: "", label: "None" }` option so the user can turn it off. Wire `onSelect` → `onAdvisorModelChange(id || undefined)`.

When the active driver is PTY, render an inline muted note ("Advisor requires the SDK driver") instead of the dropdown. Detect driver the same way `TeamsSection` does — locate that check via `grep -rn "SDK driver\|driver.*pty\|isPty\|claudeDriver" src/client`.

- [ ] **Step 3: Thread the new props from `ChatInput.tsx`**

Add `advisorModel={...}` and `onAdvisorModelChange={(m) => setComposerState(claude variant with advisorModel = m)}` where `ChatInput` renders `ChatPreferenceControls` (`:1244-1251` region). Mirror how `onModelChange` updates composer state.

- [ ] **Step 4: Component test**

Add a colocated test (kanna-react-style: colocated `*.test.tsx`) rendering `ChatPreferenceControls` with `selectedProvider="claude"` and asserting: advisor picker present, selecting an option calls `onAdvisorModelChange`, "None" clears it, and the picker is absent for `selectedProvider="codex"`.

- [ ] **Step 5: Run tests + lint**

Run:
```bash
bun test --conditions production src/client/components/chat-ui/ChatPreferenceControls.test.tsx
bun run lint
```
Expected: PASS, no warnings.

- [ ] **Step 6: Manual browser check**

Start dev server, open a Claude chat, confirm: advisor picker visible, selection persists across chat switch, hidden for Codex/OpenRouter, PTY hint shows under `KANNA_CLAUDE_DRIVER=pty`. Report what was verified (or state if the UI could not be exercised).

- [ ] **Step 7: Commit**

```bash
git add src/client/components/chat-ui/ChatPreferenceControls.tsx src/client/components/chat-ui/ChatPreferenceControls.test.tsx src/client/components/chat-ui/ChatInput.tsx
git commit -m "feat(client): advisor model picker (claude-only, PTY hint)"
```

---

## Task 7: Full verification + C3 sweep + docs

- [ ] **Step 1: Full test suite**

Run: `bun run test`
Expected: all pass. If any pre-existing failure appears, STOP and report (do not mask).

- [ ] **Step 2: Lint**

Run: `bun run lint`
Expected: 0 errors, warnings ≤ current cap.

- [ ] **Step 3: C3 change sweep**

```bash
C3X_MODE=agent bash <c3-skill-dir>/bin/c3x.sh check --include-adr
```
If the agent-coordinator contract (c3-210) needs an `advisorModel` note, update via `c3x write c3-210 --section <name>` and set ADR status `implemented`.

- [ ] **Step 4: Update CLAUDE.md**

Add a short "Advisor Tool (SDK driver)" section documenting: per-chat `advisorModel`, SDK-only, wired via `query().settings.advisorModel`, PTY ignores it. Mirror the style of the existing "Agent Teams" section.

- [ ] **Step 5: Commit + open PR**

```bash
git add -A
git commit -m "docs: advisor tool notes + c3 sweep"
```
Open PR against `cuongtranba/kanna` (`--repo cuongtranba/kanna --base main`).

---

## Optional Task 8: live smoke test (env-gated)

Only if a real OAuth token is available. Mirror `src/server/teams/teams.live.test.ts`.

- [ ] Create `src/server/advisor.live.test.ts`, gate on `KANNA_ADVISOR_LIVE_OAUTH_TOKEN`. Spawn a claude session with `advisorModel: "claude-opus-4-8"`, executor `claude-sonnet-4-6`, prompt a task that invites planning, assert the turn completes without a 400 and (if surfaced) an `advisor_tool_result` block appears. Document the run command in the test header.

---

## Self-Review

- **Spec coverage:** per-chat picker (Task 4-6), SDK-only + PTY hint (Task 6 step 2, Task 1 step 9), full-catalog no-matrix (Task 6 step 2), invalid-pair→400 surfaced (existing turn-error path — no code, documented in spec), types parallel to `model` not in `ModelOptions` (Task 1 steps 3-5), unit tests (Task 1-4), optional live test (Task 8), C3 ADR (Task 0). ✅
- **Placeholder scan:** two intentional lookups (`<c3-skill-dir>`, `ClaudeSession` interface location, PTY driver detection in client) — each is a concrete `grep` step, not a vague "handle it". ✅
- **Type consistency:** `advisorModel?: string` everywhere (protocol, QueuedChatMessage, SendMessageOptions, getProviderSettings return, startTurnForChat/startTurnAfterTurnStarted/startClaudeTurn/startClaudeSession args, ClaudeSession record, ComposerState). Empty-string "None" normalized to `undefined` at `getProviderSettings` (`.trim() || undefined`) and at client submit (`|| undefined`). ✅
