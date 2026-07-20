# Loop-Armed 429 Wake Deferral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a loop-armed chat's turn dies on a rate-limit (429) and no OAuth-pool rotation is possible, automatically schedule the wake at the quota reset time (with the full loop prompt) instead of emitting a proposal that waits for a human click.

**Architecture:** Single behavioral edit in the pure function `handleLimitDetection` (`src/server/claude-session-error-handler.ts`). Loop state is derived inline from the auto-continue event log the deps already expose — zero new dependencies. Spec: `docs/superpowers/specs/2026-07-19-loop-429-wake-deferral-design.md`.

**Tech Stack:** TypeScript (TS7 typecheck), Bun test.

## Global Constraints

- Worktree: `.worktrees/loop-429-wake-deferral`, branch `loop-429-wake-deferral`.
- Tests run with `bun test --conditions production <file>` (bare `bun test` crashes on Lexical dev ESM).
- Lint: `bun run lint` (`--max-warnings=0`). Typecheck: `bun run typecheck` (TS7 by explicit path).
- Side-effect seal: `claude-session-error-handler.ts` must stay IO-free — `deriveLoopState` is a pure import, allowed.
- `handleAuthFailure` must NOT be modified.
- No new `AutoContinueSource` variant — reuse `"auto_setting"`.

---

### Task 1: Loop-armed rate-limit deferral in `handleLimitDetection`

**Files:**
- Modify: `src/server/claude-session-error-handler.ts` (imports at ~line 17, `handleLimitDetection` body at lines 169–241)
- Modify: `src/server/auto-continue/events.ts:46-50` (doc comment on `prompt`)
- Test: `src/server/claude-session-error-handler.test.ts` (append to the `handleLimitDetection` describe block)

**Interfaces:**
- Consumes: `deriveLoopState(events, chatId): LoopState | null` from `./auto-continue/read-model` (already exported; `LoopState.prompt: string`). `SessionErrorHandlerDeps.store.getAutoContinueEvents(chatId)` (already in deps).
- Produces: no new exports. Behavior only: `auto_continue_accepted` events may now carry `prompt` when a loop is armed.

- [ ] **Step 1: Write the four failing tests**

Append inside the existing `describe("handleLimitDetection", ...)` block in `src/server/claude-session-error-handler.test.ts` (after the last test, before the closing `})` of that describe). Also add a fixture helper right below `makeLimitDetection` (top-level helpers section, ~line 95):

```ts
/** Fake loop_armed event — arms chatId with the given rendered loop prompt. */
function makeLoopArmed(chatId: string, prompt: string): AutoContinueEvent {
  return {
    v: AUTO_CONTINUE_EVENT_VERSION,
    kind: "loop_armed",
    timestamp: Date.now(),
    chatId,
    scheduleId: "loop-arm-1",
    subagentId: "sub-1",
    prompt,
  }
}
```

New tests (append inside the `handleLimitDetection` describe):

```ts
  test("armed loop + no rotation + autoResume off → accepted at waitUntil with the loop prompt", async () => {
    const resetAt = Date.now() + 120_000
    const deps = makeDeps({
      oauthPool: null,
      resolveAutoResumeFor: () => false,
      store: {
        getAutoContinueEvents: () => [makeLoopArmed("chat-1", "LOOP DISCIPLINE PROMPT")],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async () => {},
      },
    })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    const result = await handleLimitDetection(deps, "chat-1", makeLimitDetection(resetAt))
    expect(result).toBe(true)
    const ev = emitted[0]
    expect(ev?.kind).toBe("auto_continue_accepted")
    if (ev?.kind === "auto_continue_accepted") {
      expect(ev.source).toBe("auto_setting")
      expect(ev.scheduledAt).toBe(resetAt)
      expect(ev.prompt).toBe("LOOP DISCIPLINE PROMPT")
    }
  })

  test("unarmed + no rotation + autoResume off → still proposed (regression guard)", async () => {
    const deps = makeDeps({ oauthPool: null, resolveAutoResumeFor: () => false })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    expect(emitted[0]?.kind).toBe("auto_continue_proposed")
  })

  test("armed loop + rotation available → rotation branch unchanged, no prompt attached", async () => {
    const session = makeSession({ chatId: "chat-1", activeTokenId: "tok-old" })
    const deps = makeDeps({
      oauthPool: {
        markLimited: () => {},
        markError: () => {},
        pickActive: () => ({ id: "tok-new" } as never),
        earliestUnlimit: () => null,
      },
      claudeSessions: new Map([["chat-1", session]]),
      resolveAutoResumeFor: () => false,
      store: {
        getAutoContinueEvents: () => [makeLoopArmed("chat-1", "LOOP DISCIPLINE PROMPT")],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async () => {},
      },
    })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    const ev = emitted[0]
    expect(ev?.kind).toBe("auto_continue_accepted")
    if (ev?.kind === "auto_continue_accepted") {
      expect(ev.source).toBe("token_rotation")
      expect(ev.prompt).toBeUndefined()
    }
  })

  test("armed loop + autoResume on → accepted carries the loop prompt", async () => {
    const deps = makeDeps({
      oauthPool: null,
      resolveAutoResumeFor: () => true,
      store: {
        getAutoContinueEvents: () => [makeLoopArmed("chat-1", "LOOP DISCIPLINE PROMPT")],
        appendAutoContinueEvent: async () => {},
        recordTurnFailed: async () => {},
        appendMessage: async () => {},
      },
    })
    const emitted: AutoContinueEvent[] = []
    deps.emitAutoContinueEvent = async (ev) => { emitted.push(ev) }

    await handleLimitDetection(deps, "chat-1", makeLimitDetection())
    const ev = emitted[0]
    expect(ev?.kind).toBe("auto_continue_accepted")
    if (ev?.kind === "auto_continue_accepted") {
      expect(ev.prompt).toBe("LOOP DISCIPLINE PROMPT")
    }
  })
```

Note: a lone `loop_armed` event does not create a schedule, so the live-schedule dedup guard does not trip in these fixtures.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test --conditions production src/server/claude-session-error-handler.test.ts`
Expected: 3 FAIL — (1) armed+off expects `auto_continue_accepted` but gets `auto_continue_proposed`; (4) armed+on expects `prompt` but gets `undefined`; (3) may PASS already (rotation path unchanged) — that is fine. Existing tests all PASS.

- [ ] **Step 3: Implement the change in `handleLimitDetection`**

In `src/server/claude-session-error-handler.ts`:

3a. Add the import (line ~17, next to the existing `deriveChatSchedules` import):

```ts
import { deriveChatSchedules, deriveLoopState } from "./auto-continue/read-model"
```

(replaces the existing `import { deriveChatSchedules } from "./auto-continue/read-model"`)

3b. In `handleLimitDetection`, fetch the event log once and reuse it for both the dedup guard and loop state. Replace:

```ts
  const live = deriveChatSchedules(deps.store.getAutoContinueEvents(chatId), chatId).liveScheduleId
  if (live !== null) return true
```

with:

```ts
  const autoContinueEvents = deps.store.getAutoContinueEvents(chatId)
  const live = deriveChatSchedules(autoContinueEvents, chatId).liveScheduleId
  if (live !== null) return true

  // An armed loop implies auto-resume on rate limit: the loop is autonomous by
  // definition, so a proposal card waiting for a human click would stall it
  // for hours (observed in production). The stored loop prompt rides the
  // accepted event so the deferred wake re-injects the full loop discipline
  // even if the session was idle-reaped during the wait.
  const loop = deriveLoopState(autoContinueEvents, chatId)
```

3c. Widen the middle branch and attach the prompt. Replace:

```ts
  } else if (deps.resolveAutoResumeFor(chatId)) {
    event = {
      ...base,
      kind: "auto_continue_accepted",
      scheduledAt: waitUntil,
      tz: detection.tz,
      source: "auto_setting",
      resetAt: waitUntil,
      detectedAt: now,
    }
  } else {
```

with:

```ts
  } else if (deps.resolveAutoResumeFor(chatId) || loop !== null) {
    event = {
      ...base,
      kind: "auto_continue_accepted",
      scheduledAt: waitUntil,
      tz: detection.tz,
      source: "auto_setting",
      resetAt: waitUntil,
      detectedAt: now,
      ...(loop !== null ? { prompt: loop.prompt } : {}),
    }
  } else {
```

3d. Update the doc comment on `prompt` in `src/server/auto-continue/events.ts:46-50`. Replace:

```ts
      /**
       * Prompt to replay when this schedule fires. Present only for
       * `subagent_background` deliveries; provider-failure schedules omit it
       * and fire the literal `"continue"`.
       */
      prompt?: string
```

with:

```ts
      /**
       * Prompt to replay when this schedule fires. Present for
       * `subagent_background` deliveries and for armed-loop rate-limit
       * deferrals (the full loop prompt); plain provider-failure schedules
       * omit it and fire the literal `"continue"`.
       */
      prompt?: string
```

- [ ] **Step 4: Run the suite to verify all pass**

Run: `bun test --conditions production src/server/claude-session-error-handler.test.ts`
Expected: PASS (all existing + 4 new).

Also run the neighboring suites that exercise the same event log:

Run: `bun test --conditions production src/server/auto-continue/read-model.test.ts src/server/claude-session-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-session-error-handler.ts src/server/claude-session-error-handler.test.ts src/server/auto-continue/events.ts
git commit -m "feat(loop): defer 429 wake to quota reset when loop is armed

An armed loop implies auto-resume on rate limit. Without this, a
loop-armed chat whose turn died on 429 (no rotation target) emitted
auto_continue_proposed and stalled for hours waiting for a human click.
The accepted event carries the stored loop prompt so the deferred wake
re-injects the full loop discipline after an idle-reap."
```

---

### Task 2: Full verification + C3 check

**Files:**
- No new files. Runs gates over the worktree.

**Interfaces:**
- Consumes: Task 1's committed change.
- Produces: green gates; PR-ready branch.

- [ ] **Step 1: Lint**

Run: `bun run lint`
Expected: exit 0, zero warnings.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 3: Full test suite**

Run: `bun run test`
Expected: exit 0 (all suites pass).

- [ ] **Step 4: C3 mapping check**

Run: `bash ~/.claude/skills/c3/bin/c3x.sh lookup src/server/claude-session-error-handler.ts src/server/auto-continue/events.ts`
Expected: prints component mapping (or "no component mapping found"). This change alters no component boundary, ref, or public contract — internal behavior of the auto-continue error path only. If the lookup maps to a component whose docs describe the proposed-vs-accepted branch behavior, update that doc via `/c3 change` in the same branch; otherwise no C3 change-unit is required.

- [ ] **Step 5: Commit any C3 doc update (only if Step 4 required one)**

```bash
git add .c3 && git commit -m "docs(c3): auto-continue limit path — loop-armed deferral"
```
