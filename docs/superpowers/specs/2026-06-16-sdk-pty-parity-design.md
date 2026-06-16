# SDK ↔ PTY Driver Parity — Design

Date: 2026-06-16
Branch: `feat/sdk-pty-parity`
Components: c3-210 (agent-coordinator), c3-229 (workflow-status), c3-225 (claude-pty-driver)

## Problem

Several features were built for the PTY driver (`KANNA_CLAUDE_DRIVER=pty`)
but never wired for the default SDK driver. Goal: close the genuine gaps so
both drivers behave the same where the gap is real, and document the gaps
that are already closed by shared code.

Investigation (code-grounded, against `origin/main` @ e79270c):

- The HarnessEvent consume loop `runClaudeSession` (`agent.ts:~2790+`) is
  **shared by both drivers**. Anything wired there already works for SDK.
- `startClaudeSession` (SDK, `agent.ts:996`) already drives a warm session
  via an open `AsyncMessageQueue` prompt queue and exposes `sendPrompt`
  (`agent.ts:170,1104`). The SDK keeps the session alive natively (streaming
  input mode — confirmed against Agent SDK docs).
- Claude's `wf_<runId>.json` workflow sidecars are written by the `claude`
  binary regardless of driver. PTY's documented limitation was the
  *transcript event stream* lacking lifecycle lines — NOT the sidecars.

## Scope

In scope:

1. **Keep-alive multi-turn subagents (#1+#2)** — genuine gap.
2. **Workflow Status Panel (#3)** — genuine gap; reuse disk-watch read-model.
3. **Background-task keep-alive guard (#4)** — already wired in shared loop;
   verification test only, no production code expected.

Out of scope: live status panel (`PtyInstanceRegistry`) and PID-registry
crash-reap — both are inherent to owning an OS process and do not map onto
the SDK driver. Codex provider keep-alive (claude-only, unchanged).

## Design

### #1+#2 Keep-alive subagents (SDK-native streaming input)

No channel-delivery port. The SDK already supports multi-turn over the open
prompt queue. Two edits:

1. `startClaudeSession` gains a `keepAlive?: boolean` arg. When true and an
   `initialPrompt` is supplied, **do not** call `promptQueue.close()`
   (`agent.ts:1088`) — leave the queue open so turn 2+ can be pushed.
   One-shot (default) keeps closing the queue exactly as today.
2. `subagent-provider-run.ts` `runClaudeSubagent` keep-alive path
   (`:179-186`): the `LiveTurnSource.runTurn` uses `session.pushChannelPrompt`
   when present (PTY) and falls back to `session.sendPrompt` when absent
   (SDK), instead of throwing. The per-turn drain (`drainOneTurn` over
   `session.stream`) already leaves the iterator open between turns — no
   change. The keep-alive subagent must thread `keepAlive: true` into
   `startClaudeSession` (extend `BuildSubagentProviderRunArgs.startClaudeSession`
   signature with the optional flag).

Result: `delegate_subagent({ keep_alive: true })` works under the SDK driver.
Turn 1 drains through the existing plumbing; follow-up turns push via
`sendPrompt` and drain one turn each.

### #3 Workflow Status Panel (reuse disk-watch read-model — c3-229)

`workflowRegistry.register(chatId, dir)` is currently called only by the PTY
driver. The SDK driver never registers, so `snapshot`/`hasActiveRun` always
return empty/false for SDK chats. Wire registration on the SDK path:

1. The SDK surfaces Claude's on-disk session UUID as `{type:"session_token"}`
   HarnessEvents (`agent.ts:764`). On the **first** session-token for an SDK
   claude session in `runClaudeSession`, derive
   `<projectDir>/<session-uuid>/workflows` via the `jsonl-path` adapter
   (`computeProjectDir`, same helper PTY uses) and call
   `workflowRegistry.register(chatId, dir)`. Guard against re-register on
   every token event (register once per resolved UUID).
2. Mirror PTY's late-register cancel guard: if the session is torn down
   before the token arrives, do not register; `unregister(chatId)` on session
   close.

This stays inside c3-229's "watch sidecar files from disk" mandate. It does
NOT read the transcript JSONL for workflow data, so the c3-225 "transcript is
the sole event source" invariant is untouched — the session UUID comes from
the SDK's own `session_id`, not transcript parsing. Registry, WS transport
(`workflows` topic), and client (`workflowsStore`, `WorkflowsSection`) are
already driver-agnostic — no change. Side benefit: `hasLiveWorkflow` starts
returning true for SDK, so the pending-workflow auto-wake arms for SDK too.

### #4 Background-task keep-alive guard (verification only)

The arm (`backgroundTaskIdsFromToolResult` on `tool_result`,
`agent.ts:2846-2855`) and the idle-reaper guards (`hasPendingBackgroundTask`,
`agent.ts:1504-1505,1551-1552`) live in the shared consume loop. SDK sessions
are resident and idle-reaped exactly like PTY (`claudeSessions`,
max-resident 4). So the guard already protects SDK background tasks. Only
risk: confirm SDK `tool_result` content carries the literal
`Command running in background with ID:` string (same CLI ⇒ expected).

Deliverable: a colocated test that drives the SDK harness path with a
`tool_result` carrying that text and asserts `backgroundTaskDeadlineAt` is
armed + `hasPendingBackgroundTask` holds the session warm. If the assertion
fails, escalate (do not silently add a parser branch).

## Testing

- `subagent-provider-run.test.ts`: SDK keep-alive turn 2 drives via
  `sendPrompt` (no `pushChannelPrompt`), drains one turn, returns text;
  one-shot path still closes the queue.
- `agent.ts` keep-alive flag: queue stays open with `keepAlive: true`,
  closes without it.
- Workflow registration: first SDK `session_token` registers the derived
  workflows dir once; close unregisters; no re-register on repeat tokens.
- #4 verification test as above.
- All colocated `*.test.ts` (rule-colocated-bun-test). Strong typing at all
  boundaries (rule-strong-typing) — `keepAlive` is a typed optional, no `any`.

## Risks / open questions

- SDK `q.close()` killing background-task children on idle reap is the exact
  scenario the #4 guard prevents; verify the guard fires before claiming #4
  done.
- Workflows-dir UUID timing: the dir derivation depends on the first
  `session_token`; a workflow launched before the token arrives is briefly
  invisible (same race PTY tolerates — sidecar is re-read on watch).
