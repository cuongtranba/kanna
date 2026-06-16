# SDK ↔ PTY Driver Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring three PTY-driver features to parity on the default SDK driver: keep-alive multi-turn subagents, the workflow status panel, and confirm the background-task keep-alive guard.

**Architecture:** The HarnessEvent consume loop (`runClaudeSession`) and the subagent run plumbing are driver-agnostic; the gaps are at the driver-specific edges. Keep-alive uses the SDK's native streaming-input prompt queue (no channel transport). The workflow panel reuses the existing disk-watch `WorkflowRegistry` — Claude's `wf_*.json` sidecars are written regardless of driver — by registering the workflows dir from the SDK's `session_token`. The background-task guard already lives in the shared loop; it needs a verification test only.

**Tech Stack:** TypeScript, Bun test, Claude Agent SDK (`query()` streaming input), ports-and-adapters seal (IO only in `*.adapter.ts`).

**Spec:** `docs/superpowers/specs/2026-06-16-sdk-pty-parity-design.md`

**Branch / worktree:** `feat/sdk-pty-parity` at `.worktrees/sdk-pty-parity` (off `origin/main` @ e79270c).

**Working-state facts (verified against the worktree, NOT the stale main checkout):**
- `keepAlive` is currently dropped between `runClaudeSubagent` and `startClaudeSession`/driver — keep-alive is incomplete for BOTH drivers today. Completing the thread is part of this work.
- `startClaudeSession` (SDK) closes the prompt queue at `agent.ts:1151` right after pushing `initialPrompt`.
- The SDK handle already exposes `sendPrompt` (`agent.ts:1167`) that pushes onto the same `AsyncMessageQueue`.
- `ClaudeSessionHandle.pushChannelPrompt?` (`agent.ts:175`) is the field `runClaudeSubagent` keep-alive uses for turn 2+ (`subagent-provider-run.ts:189-202`).
- SDK `session_token` events arrive in `runClaudeSession` at `agent.ts:2891`; the resident-session loop is the correct hook for workflow registration.
- `backgroundTaskIdsFromToolResult` (`agent.ts:1241`) + the idle-reaper guard (`hasPendingBackgroundTask`, used by `isClaudeSessionIdle` / budget enforcer) are already in the shared loop.

---

### Task 1: Thread `keepAlive` end-to-end and enable SDK keep-alive transport

**Files:**
- Modify: `src/server/subagent-provider-run.ts` (`BuildSubagentProviderRunArgs.startClaudeSession` type ~52-69; `runClaudeSubagent` startClaudeSession call ~150-167)
- Modify: `src/server/agent.ts` (`startClaudeSession` signature ~1054-1083; queue close ~1151; handle return ~1154-1177; `buildClaudeSubagentStarter` ~2658-2690; `AgentCoordinatorArgs.startClaudeSession` injected type ~222+)
- Test: `src/server/subagent-provider-run.test.ts`

- [ ] **Step 1: Write the failing test** — SDK keep-alive drives turn 2 via the handle's `pushChannelPrompt` (queue-backed), no channel transport.

Add to `src/server/subagent-provider-run.test.ts`:

```ts
import { buildSubagentProviderRun } from "./subagent-provider-run"
import type { ClaudeSessionHandle } from "./agent"
import type { HarnessEvent } from "./harness-types"
import { timestamped } from "../shared/types" // adjust to the helper the suite already uses

function harnessStream(turns: HarnessEvent[][]): { stream: AsyncIterable<HarnessEvent>; pushNext: () => void } {
  // Emits turns[0] immediately; each pushNext() releases the next turn's events.
  let resolveGate: (() => void) | null = null
  let turnIdx = 0
  async function* gen(): AsyncGenerator<HarnessEvent> {
    for (const ev of turns[0]) yield ev
    for (turnIdx = 1; turnIdx < turns.length; turnIdx++) {
      await new Promise<void>((r) => { resolveGate = r })
      for (const ev of turns[turnIdx]) yield ev
    }
  }
  return { stream: gen(), pushNext: () => { resolveGate?.() } }
}

test("SDK keep-alive subagent drives turn 2 via queue-backed pushChannelPrompt", async () => {
  const t1: HarnessEvent[] = [
    { type: "transcript", entry: timestamped({ kind: "assistant_text", text: "turn1" }) },
    { type: "transcript", entry: timestamped({ kind: "result", isError: false, result: "ok" }) },
  ]
  const t2: HarnessEvent[] = [
    { type: "transcript", entry: timestamped({ kind: "assistant_text", text: "turn2" }) },
    { type: "transcript", entry: timestamped({ kind: "result", isError: false, result: "ok" }) },
  ]
  const { stream, pushNext } = harnessStream([t1, t2])
  const pushed: string[] = []
  const session: ClaudeSessionHandle = {
    provider: "claude",
    stream,
    interrupt: async () => {},
    close: () => {},
    sendPrompt: async () => {},
    setModel: async () => {},
    setPermissionMode: async () => {},
    getSupportedCommands: async () => [],
    // SDK keep-alive populates this with a queue push:
    pushChannelPrompt: async (text) => { pushed.push(text); pushNext() },
  }
  let keepAlivePassed: boolean | undefined
  const run = buildSubagentProviderRun({
    // minimal args — reuse the suite's existing builder/fixture helper
    ...makeSubagentArgs({ provider: "claude" }),
    startClaudeSession: async (a) => { keepAlivePassed = a.keepAlive; return session },
  })
  const chunks: string[] = []
  const res = await run.start((c) => chunks.push(c), () => {}, { keepAlive: true })
  expect(keepAlivePassed).toBe(true)
  expect(res.text).toBe("turn1")
  expect(res.live).toBeDefined()
  const turn2 = await res.live!.runTurn("go again", (c) => chunks.push(c), () => {})
  expect(pushed).toEqual(["go again"])
  expect(turn2.text).toBe("turn2")
  await res.live!.close()
})
```

> If `makeSubagentArgs` / `timestamped` are not the exact helpers in the suite, use whatever the existing tests in this file use to build `BuildSubagentProviderRunArgs` and transcript entries — do not invent new fixtures.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/server/subagent-provider-run.test.ts -t "SDK keep-alive"`
Expected: FAIL — `keepAlive` not forwarded (`keepAlivePassed` is `undefined`) and/or type error on `a.keepAlive`.

- [ ] **Step 3: Add `keepAlive` to the subagent starter arg type**

In `src/server/subagent-provider-run.ts`, extend the `startClaudeSession` arg object type (after `restrictedAllowedPaths?: string[]` at ~68):

```ts
    restrictedAllowedPaths?: string[]
    /** When true (claude only), keep the session warm for multi-turn keep-alive. */
    keepAlive?: boolean
  }) => Promise<ClaudeSessionHandle>
```

- [ ] **Step 4: Forward `keepAlive` from `runClaudeSubagent`**

In `runClaudeSubagent` (`subagent-provider-run.ts` ~150), add to the `startClaudeSession({...})` call (alongside `restrictedAllowedPaths`):

```ts
    restrictedAllowedPaths: args.allowedPaths,
    keepAlive,
  })
```

(`keepAlive` is already destructured from `opts` at the top of the function.)

The existing keep-alive block (`if (!session.pushChannelPrompt) { ... throw }`) stays unchanged — it remains the fail-closed guard for PTY-without-channel, and is now satisfied for SDK because Step 6 populates `pushChannelPrompt`.

- [ ] **Step 5: Add `keepAlive` to `startClaudeSession` and the injected `AgentCoordinatorArgs` type**

In `src/server/agent.ts`, add to the `startClaudeSession` arg type (after `restrictedAllowedPaths?` ~1083):

```ts
  restrictedAllowedPaths?: string[]
  /** Keep the SDK prompt queue open after initialPrompt for multi-turn keep-alive. */
  keepAlive?: boolean
}): Promise<ClaudeSessionHandle> {
```

Add the same optional field to the `AgentCoordinatorArgs.startClaudeSession?: (args: {...})` type (~222) so injected fakes and the production fn share the contract.

- [ ] **Step 6: Keep the SDK queue open + expose `pushChannelPrompt` when `keepAlive`**

In `startClaudeSession`, change the initialPrompt close (`agent.ts:1151`):

```ts
  if (args.initialPrompt != null) {
    promptQueue.push({
      type: "user",
      message: { role: "user", content: args.initialPrompt },
      parent_tool_use_id: null,
      session_id: args.sessionToken ?? undefined,
    })
    if (!args.keepAlive) promptQueue.close()
  }
```

In the returned handle object (`agent.ts:1154-1177`), add `pushChannelPrompt` only for keep-alive (reuse the same queue-push as `sendPrompt`):

```ts
    sendPrompt: async (content: string) => {
      promptQueue.push({
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        session_id: args.sessionToken ?? "",
      })
    },
    ...(args.keepAlive
      ? {
          pushChannelPrompt: async (content: string) => {
            promptQueue.push({
              type: "user",
              message: { role: "user", content },
              parent_tool_use_id: null,
              session_id: args.sessionToken ?? "",
            })
          },
        }
      : {}),
```

- [ ] **Step 7: Forward `keepAlive` through `buildClaudeSubagentStarter`**

In `agent.ts` `buildClaudeSubagentStarter` (~2660), add `keepAlive: a.keepAlive` to the PTY branch object (after `restrictedAllowedPaths: a.restrictedAllowedPaths` ~2685). The SDK branch (`return this.startClaudeSessionFn({ ...a, customMcpServers })` ~2688) already forwards it via the spread once the type includes it.

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test src/server/subagent-provider-run.test.ts -t "SDK keep-alive"`
Expected: PASS.

- [ ] **Step 9: Run the full suite for regressions**

Run: `bun test src/server/subagent-provider-run.test.ts src/server/claude-pty/driver.test.ts`
Expected: PASS (no fails; the 2 pre-existing skips remain).

- [ ] **Step 10: Commit**

```bash
git add src/server/subagent-provider-run.ts src/server/agent.ts src/server/subagent-provider-run.test.ts
git commit -m "feat(agent): enable keep-alive subagents on the SDK driver via streaming input"
```

---

### Task 2: `computeWorkflowsDir` helper

**Files:**
- Modify: `src/server/claude-pty/jsonl-path.adapter.ts`
- Test: `src/server/claude-pty/jsonl-path.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/server/claude-pty/jsonl-path.test.ts`:

```ts
import { computeWorkflowsDir, computeProjectDir } from "./jsonl-path.adapter"

test("computeWorkflowsDir = <projectDir>/<sessionId>/workflows", () => {
  const cwd = process.cwd() // an existing dir (realpathSync requires it)
  const sessionId = "11111111-2222-3333-4444-555555555555"
  const expected = `${computeProjectDir({ homeDir: "/home/x", cwd })}/${sessionId}/workflows`
  expect(computeWorkflowsDir({ homeDir: "/home/x", cwd, sessionId })).toBe(expected)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/server/claude-pty/jsonl-path.test.ts -t "computeWorkflowsDir"`
Expected: FAIL — `computeWorkflowsDir` is not exported.

- [ ] **Step 3: Add the helper**

In `src/server/claude-pty/jsonl-path.adapter.ts`, after `computeJsonlPath`:

```ts
export function computeWorkflowsDir(args: {
  homeDir: string
  cwd: string
  sessionId: string
}): string {
  return path.join(
    computeProjectDir({ homeDir: args.homeDir, cwd: args.cwd }),
    args.sessionId,
    "workflows",
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/server/claude-pty/jsonl-path.test.ts -t "computeWorkflowsDir"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/claude-pty/jsonl-path.adapter.ts src/server/claude-pty/jsonl-path.test.ts
git commit -m "feat(claude-pty): add computeWorkflowsDir path helper"
```

---

### Task 3: Register the workflows dir for SDK sessions

**Files:**
- Modify: `src/server/agent.ts` (`ClaudeSessionState` ~183; import `computeWorkflowsDir`; `session_token` handler ~2891; a new `maybeRegisterSdkWorkflowsDir` method; `unregister` on session close)
- Test: `src/server/agent.*.test.ts` (add a focused suite `agent.sdk-workflow-register.test.ts` colocated)

- [ ] **Step 1: Write the failing test**

Create `src/server/agent.sdk-workflow-register.test.ts`. Drive a fake SDK `startClaudeSession` returning a handle whose stream emits one `session_token` event, with a fake `WorkflowRegistry` recording `register` calls and `resolveClaudeDriverPreference()` → `"sdk"`.

```ts
import { test, expect } from "bun:test"
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"
import { homedir } from "node:os"
// Use the suite's existing AgentCoordinator test harness/factory.
import { makeCoordinatorForTest } from "./test-helpers/coordinator" // adjust to the real helper

test("SDK session registers workflows dir on first session_token", async () => {
  const registered: Array<{ chatId: string; dir: string }> = []
  const workflowRegistry = {
    register: (chatId: string, dir: string) => registered.push({ chatId, dir }),
    unregister: () => {},
    snapshot: () => [],
    getRun: () => null,
    hasActiveRun: () => false,
    subscribe: () => () => {},
  }
  const cwd = process.cwd()
  const sessionUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  const coord = makeCoordinatorForTest({
    driverPreference: "sdk",
    workflowRegistry,
    startClaudeSession: async () => fakeSdkHandleEmitting({ sessionToken: sessionUuid, cwd }),
  })
  await coord.sendUserMessageAndDrain({ /* chat in cwd */ })
  expect(registered).toHaveLength(1)
  expect(registered[0].dir).toBe(
    computeWorkflowsDir({ homeDir: homedir(), cwd, sessionId: sessionUuid }),
  )
})
```

> Match the suite's real coordinator factory and drain helper (see existing `agent.*.test.ts`). If none provides a `driverPreference` knob, set it via the app-settings snapshot the harness already uses.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/server/agent.sdk-workflow-register.test.ts`
Expected: FAIL — `register` never called for the SDK path.

- [ ] **Step 3: Add the once-flag to `ClaudeSessionState`**

In `agent.ts` `ClaudeSessionState` (~183), add (optional, so existing init sites stay valid):

```ts
  backgroundTaskDeadlineAt: number
  /** SDK only: set once the workflows dir has been registered for this session. */
  workflowsDirRegistered?: boolean
}
```

- [ ] **Step 4: Import the helper**

At the top of `agent.ts`, add to the existing `claude-pty` imports:

```ts
import { computeWorkflowsDir } from "./claude-pty/jsonl-path.adapter"
```

(`homedir` is already imported at `agent.ts:4`.)

- [ ] **Step 5: Add the registration method**

Add a private method on `AgentCoordinator`:

```ts
  private maybeRegisterSdkWorkflowsDir(session: ClaudeSessionState): void {
    if (!this.workflowRegistry) return
    if (session.workflowsDirRegistered) return
    // PTY registers from its own resolved transcript path; SDK derives from session_token.
    if (this.resolveClaudeDriverPreference() === "pty") return
    if (!session.sessionToken) return
    const dir = computeWorkflowsDir({
      homeDir: homedir(),
      cwd: session.localPath,
      sessionId: session.sessionToken,
    })
    this.workflowRegistry.register(session.chatId, dir)
    session.workflowsDirRegistered = true
  }
```

- [ ] **Step 6: Call it from the `session_token` handler**

In `runClaudeSession` (`agent.ts:2891`):

```ts
        if (event.type === "session_token" && event.sessionToken) {
          session.sessionToken = event.sessionToken
          await this.store.setSessionTokenForProvider(session.chatId, "claude", event.sessionToken)
          this.maybeRegisterSdkWorkflowsDir(session)
          this.emitStateChange(session.chatId)
          continue
        }
```

- [ ] **Step 7: Unregister on SDK session close**

Locate `closeClaudeSession` (the method that tears down a resident claude session). Add, guarded so it only fires for SDK (PTY's driver owns its own unregister):

```ts
    if (this.resolveClaudeDriverPreference() !== "pty") {
      this.workflowRegistry?.unregister(chatId)
    }
```

> Verify whether `closeClaudeSession` already calls `unregister` before adding — if a shared cleanup path already unregisters for all drivers, skip this step. `unregister` is idempotent, so a duplicate is harmless but avoid the dead code.

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test src/server/agent.sdk-workflow-register.test.ts`
Expected: PASS.

- [ ] **Step 9: Run related suites for regressions**

Run: `bun test src/server/agent.pty-rotation.test.ts src/server/workflow-registry.test.ts src/server/agent.sdk-workflow-register.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/server/agent.ts src/server/agent.sdk-workflow-register.test.ts
git commit -m "feat(agent): register workflow disk-watch dir for SDK sessions"
```

---

### Task 4: Verify the background-task keep-alive guard works under SDK

**Files:**
- Modify (export only, if needed): `src/server/agent.ts` (`backgroundTaskIdsFromToolResult`)
- Test: `src/server/agent.background-task-sdk.test.ts` (colocated)

- [ ] **Step 1: Confirm the detector is exported**

Run: `bun -e "import('./src/server/agent.ts').then(m => console.log(typeof m.backgroundTaskIdsFromToolResult))"`
Expected: `function`. If `undefined`, add `export` to `function backgroundTaskIdsFromToolResult` at `agent.ts:1241`.

- [ ] **Step 2: Write the test** — the SDK-normalized `tool_result` content carrying Claude Code's background-launch line is detected.

Create `src/server/agent.background-task-sdk.test.ts`:

```ts
import { test, expect } from "bun:test"
import { backgroundTaskIdsFromToolResult } from "./agent"

test("detects background task id from SDK tool_result content", () => {
  // The SDK normalizes a Bash(run_in_background) result to the same CLI text.
  const content = "Command running in background with ID: bg_abc123\n"
  expect(backgroundTaskIdsFromToolResult(content)).toEqual(["bg_abc123"])
})

test("detects background task id from array/block content shape", () => {
  const content = [{ type: "text", text: "Command running in background with ID: bg_xyz789" }]
  expect(backgroundTaskIdsFromToolResult(content)).toEqual(["bg_xyz789"])
})

test("no false positive on ordinary tool_result", () => {
  expect(backgroundTaskIdsFromToolResult("done\n")).toEqual([])
})
```

> Match the exact content shape `backgroundTaskIdsFromToolResult` parses — read `agent.ts:1241` first and mirror its expected input (string vs block array). Adjust the second test to the real shape; do not assert a shape the function does not accept.

- [ ] **Step 3: Run the test**

Run: `bun test src/server/agent.background-task-sdk.test.ts`
Expected: PASS. If the string-content test fails, the SDK normalizes background results differently than PTY — STOP and report (this would mean #4 is NOT already covered for SDK and needs a real fix, which is out of this plan's assumed scope).

- [ ] **Step 4: Commit**

```bash
git add src/server/agent.background-task-sdk.test.ts src/server/agent.ts
git commit -m "test(agent): verify background-task guard detection under the SDK driver"
```

---

### Task 5: C3 ADR + docs sync

**Files:**
- C3 (CLI only): one ADR via `c3x add adr`
- Modify: `CLAUDE.md` (sections "Keep-Alive Multi-Turn Subagents (claude-PTY only)" and "Workflow Status Panel (PTY ... only)" — update scope to include SDK)

- [ ] **Step 1: Create the ADR (work order, before doc edits)**

```bash
C3X_MODE=agent bash /Users/cuongtran/.claude/skills/c3/bin/c3x.sh schema adr
```
Then `c3x add adr adr-20260616-sdk-pty-feature-parity` with a body covering: context (PTY-only features), decision (SDK keep-alive via streaming input; SDK workflow registration reuses disk-watch read-model; background-task guard already shared), components touched (c3-210, c3-229), and a Parent Delta note. Transition `proposed → accepted` per the c3 ADR lifecycle.

- [ ] **Step 2: Update `CLAUDE.md` scope lines**

- "## Keep-Alive Multi-Turn Subagents (claude-PTY only)" → "(claude SDK + PTY)"; add a sentence: SDK keep-alive uses the streaming-input prompt queue (no channel transport); the handle's `pushChannelPrompt` is queue-backed under SDK.
- "# Workflow Status Panel (PTY disk-watch, read-only)" and its "Out of scope: SDK driver" line → SDK now registers the same disk-watch dir from `session_token`; remove SDK from "Out of scope".

- [ ] **Step 3: Validate C3**

```bash
C3X_MODE=agent bash /Users/cuongtran/.claude/skills/c3/bin/c3x.sh check --include-adr
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md .c3/
git commit -m "docs(c3): record SDK↔PTY parity ADR + update driver scope notes"
```

---

### Final verification

- [ ] Run the touched suites together:

Run: `bun test src/server/subagent-provider-run.test.ts src/server/claude-pty/jsonl-path.test.ts src/server/agent.sdk-workflow-register.test.ts src/server/agent.background-task-sdk.test.ts src/server/claude-pty/driver.test.ts src/server/workflow-registry.test.ts`
Expected: all PASS.

- [ ] Run lint:

Run: `bun run lint`
Expected: 0 errors, warnings at/under the cap.

- [ ] Open PR against `cuongtranba/kanna` (`--base main --head feat/sdk-pty-parity --repo cuongtranba/kanna`).
