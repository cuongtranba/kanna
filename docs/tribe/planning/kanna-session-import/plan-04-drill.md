# PR D — Subagent Drill-In for Imported Chats (WS-Drill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `Agent`/Task tool cards inside an *imported* chat drill into their Hunter/Skinner child transcripts, read from `~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl` — the files where a Tribe campaign's real work lives.

**Architecture:** The existing `SubagentTranscriptRegistry` (`src/server/subagent-transcript-registry.ts`) already parses exactly these sidecar files but is only `register()`ed by the live PTY driver. Add lazy derivation: when the drill-in ws command arrives for a chat with no registration, derive the subagents dir from the chat's stored Claude session token + its project cwd (via `computeProjectDir` in `src/server/claude-pty/jsonl-path.adapter.ts`), register, and serve. Zero persistence; survives restart by re-deriving.

**Tech Stack:** Bun + TypeScript; no new IO (registry's existing `subagent-transcript-io.adapter.ts` does the reads).

## Global Constraints

- Depends on PR A merged (imported chats exist with `sessionTokensByProvider.claude` set). Independent of PR B/C.
- WALL: live-session registrations (driver-owned) take precedence — lazy derivation must never overwrite an existing registration.
- WALL: sidechain parsing stays out of the turn pipeline (the registry already guarantees this — keep using `normalizeClaudeStreamMessage`, never `createJsonlEventParser`).
- Suites + lint green; PR targets `cuongtranba/kanna`; no agent co-author.

---

### Task 1: Spike — confirm the render path end-to-end (timeboxed, throwaway branch commit allowed)

**Files:**
- Read only: `src/server/ws-router.ts:2208-2220` (the drill-in command case — note its exact command `type` string), `src/client` call site of that command (grep the command type), `src/server/subagent-transcript-registry.ts`, `src/server/claude-pty/jsonl-path.adapter.ts` (confirm `computeProjectDir(cwd)` export name/signature).

**Interfaces:**
- Produces: a written GO/NO-GO note appended to `~/Downloads/kanna-session-import/INDEX.md` under "Decision log" — either "D5 confirmed: lazy registration serves imported chats via <command type>" or the fallback decision (on-demand read in the ws case without the registry).

- [ ] **Step 1:** Import a real session by UUID (PR A path or a test store) whose source dir has a `subagents/` sibling — e.g. a session under `~/.claude/projects/-Users-home-repos-todd-skills*/` from a past campaign. Record: does the imported transcript contain `tool_call` entries for the `Agent`/Task tool with an `agentId` in their payload (the client needs it to request the child transcript)? Check with `store.getMessages(chatId)` in a scratch test.
- [ ] **Step 2:** If `agentId` is present → GO. If absent (imported tool_use rows lack the `toolUseResult` sidecar data the live path enriches from), record NO-GO with the evidence and STOP this PR — update INDEX.md status to `blocked(needs-mapper-enrichment)` and file the finding; the fix (mapper enrichment of Task tool results) becomes a new task appended to this plan before proceeding.

### Task 2: Lazy derivation helper (pure)

**Files:**
- Create: `src/server/imported-subagents-dir.ts`
- Test: `src/server/imported-subagents-dir.test.ts`

**Interfaces:**
- Consumes: `computeProjectDir` from `./claude-pty/jsonl-path.adapter` (pure path math; verify export during Task 1).
- Produces: `deriveImportedSubagentsDir(args: { cwd: string; claudeSessionToken: string }): string` — absolute `<computeProjectDir(cwd)>/<token>/subagents`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, test } from "bun:test"
import { deriveImportedSubagentsDir } from "./imported-subagents-dir"

describe("deriveImportedSubagentsDir", () => {
  test("joins encoded project dir + session uuid + subagents", () => {
    const dir = deriveImportedSubagentsDir({
      cwd: "/Users/home/repos/kanna",
      claudeSessionToken: "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f",
    })
    expect(dir.endsWith("/-Users-home-repos-kanna/4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f/subagents")).toBe(true)
  })
})
```

- [ ] **Step 2: Verify fail → implement** (thin: `path.join(computeProjectDir(cwd), token, "subagents")` — match `computeProjectDir`'s actual signature, it may take homeDir; mirror how `driver.ts` calls it) **→ verify pass → commit** `feat(server): derive subagents dir for imported chats`.

### Task 3: Wire lazy registration into the drill-in command

**Files:**
- Modify: `src/server/ws-router.ts` (the case at ~2214 that calls `subagentTranscriptRegistry.getAgentTranscript`)
- Test: `src/server/subagent-transcript-registry.test.ts` — append a case, or a small ws-router-level test if the file has a harness for command cases (check `ws-router` test files for the pattern; otherwise test the extracted helper below).

**Interfaces:**
- Consumes: `deriveImportedSubagentsDir` (Task 2), `SubagentTranscriptRegistry.register/getAgentTranscript`, `store.state.chatsById` + `store.getProject` (cwd lookup).

- [ ] **Step 1:** Extract the lookup into a helper in the same file so it is testable:

```ts
function ensureSubagentDirRegistered(
  registry: SubagentTranscriptRegistry,
  store: EventStore,
  chatId: string,
): void {
  // never overwrite a live registration: getAgentTranscript returns [] for
  // unknown chat — probe registration via a registry.has(chatId) accessor
  // (add `has(chatId: string): boolean` to the registry interface: one-line
  // `dirByChat.has(chatId)`).
  if (registry.has(chatId)) return
  const chat = store.state.chatsById.get(chatId)
  const token = chat?.sessionTokensByProvider.claude
  if (!chat || !token) return
  const project = store.getProject(chat.projectId)
  if (!project) return
  registry.register(chatId, deriveImportedSubagentsDir({ cwd: project.localPath, claudeSessionToken: token }))
}
```

Call it at the top of the drill-in case before `getAgentTranscript`. (Field names `projectId`/`localPath`: confirm against `ChatRecord`/project record in `src/server/events.ts` during implementation; the importer uses `store.openProject(session.cwd)` and `chat.sessionTokensByProvider.claude` — those are authoritative.)

- [ ] **Step 2: Test** — registry with fake `readAgentTranscriptLines` returning two JSONL lines of a minimal assistant message; imported-shaped chat in a test store; assert the ws helper registers and `getAgentTranscript` returns entries; assert a pre-registered (live) chat's dir is NOT overwritten.

- [ ] **Step 3: Manual evidence** — drill into a Hunter transcript on a real imported Tribe session; screenshot for the PR.

- [ ] **Step 4: Gates + commit + PR** — full suite + lint; `git commit -m "feat(server): subagent drill-in for imported chats via lazy dir derivation"`; PR to `cuongtranba/kanna`.

## Self-review checklist

- [ ] `registry.has()` added without changing existing callers' behavior.
- [ ] Live registrations always win (test proves it).
- [ ] No new fs imports outside adapters (derivation is pure path math).
- [ ] Task 1's GO/NO-GO recorded in INDEX.md before Tasks 2–3 started.
