# Phase 1 — Provider-Independent Primary Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the first-turn provider lock. A chat may switch provider on any turn. Each provider keeps its own resume token under the chat record (`sessionTokensByProvider`) so switching back later resumes its prior session. Inject a synthetic history primer only when the target provider has no token for this chat.

**Architecture:** Replace scalar `chat.sessionToken` with a per-provider map. Add an optional `provider` field to `session_token_set` / `pending_fork_session_token_set` events (no `STORE_VERSION` bump). Replay attributes legacy events to the chat's then-current provider via the most recent `chat_provider_set`. The send flow keys session lookups by `composerState.provider` (the turn's target), and `startTurnForChat` builds a one-shot history primer when the target provider's slot is null. Client unlocks the model selector and reads new shape via `ChatRuntime`.

**Tech Stack:** TypeScript, Bun, React 19, Zustand, bun:test, JSONL event log.

**Design reference:** `docs/superpowers/specs/2026-05-13-model-independent-chat-phase1-provider-switching.md`.

**Baseline:** Branch `plans/model-independent-chat` (worktree), clean tree at `ddee92b`. Verify `bun test` passes before starting. Confirm with `bun test 2>&1 | tail -5`.

---

## File Structure

**Server (modify):**
- `src/server/events.ts` — event shape additions (optional `provider`), `ChatRecord` field swap
- `src/server/event-store.ts` — replay-time attribution, new `setSessionTokenForProvider`, snapshot legacy projection, `forkChat` provider-tagged
- `src/server/agent.ts` — read/write per-provider slot in `startTurnForChat`; primer injection for primary turns
- `src/server/read-models.ts` — `canForkChat` reads new shape; `ChatRuntime` projection
- `src/server/history-primer.ts` (new) — `buildHistoryPrimer` + `PRIMER_MAX_CHARS`

**Shared (modify):**
- `src/shared/types.ts` — `ChatRuntime.sessionTokensByProvider` replaces `sessionToken`

**Client (modify):**
- `src/client/app/useKannaState.ts` — runtime equality check uses new shape
- `src/client/components/chat-ui/ChatInput.tsx` — drop `providerLocked` gate
- `src/client/components/chat-ui/ChatPreferenceControls.tsx` — drop `providerLocked` prop
- `src/client/app/SettingsPage.tsx` — drop hard-coded `providerLocked` callsites

**Tests:**
- `src/server/event-store.test.ts` (extend)
- `src/server/agent.test.ts` (extend)
- `src/server/read-models.test.ts` (extend)
- `src/server/history-primer.test.ts` (new)
- `src/client/app/useKannaState.test.ts` (extend)

---

## Task 1 — Add `sessionTokensByProvider` to `ChatRecord`

**Files:**
- Modify: `src/server/events.ts:8-28` (ChatRecord)

- [ ] **Step 1: Update `ChatRecord` shape**

Edit `src/server/events.ts`. Replace lines 19 and 21:

```ts
// BEFORE
sessionToken: string | null
sourceHash: string | null
pendingForkSessionToken?: string | null

// AFTER
sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
sourceHash: string | null
pendingForkSessionToken?: { provider: AgentProvider; token: string } | null
```

Keep `chat.provider` (line 17) — now means "last-used provider" (informational), not a lock.

- [ ] **Step 2: Run typecheck and capture failure list**

Run: `bun run check 2>&1 | tail -40`
Expected: FAIL. Many references to `chat.sessionToken`. Record the list — Tasks 2-9 each address a subset.

- [ ] **Step 3: Commit (broken build is fine — locked-in shape)**

```bash
git add src/server/events.ts
git commit -m "refactor(events): switch ChatRecord to sessionTokensByProvider"
```

---

## Task 2 — Add optional `provider` field to token events

**Files:**
- Modify: `src/server/events.ts:201-221` (TurnEvent variants)

- [ ] **Step 1: Edit `session_token_set` and `pending_fork_session_token_set`**

In `src/server/events.ts`, replace the two variants (lines 201-207 and 215-221):

```ts
| {
    v: 3
    type: "session_token_set"
    timestamp: number
    chatId: string
    sessionToken: string | null
    provider?: AgentProvider
  }
| {
    v: 3
    type: "pending_fork_session_token_set"
    timestamp: number
    chatId: string
    pendingForkSessionToken: string | null
    provider?: AgentProvider
  }
```

`STORE_VERSION` stays at 3 — `event-store.ts:468` filters by exact version, a bump wipes all v3 logs.

- [ ] **Step 2: Run typecheck**

Run: `bun run check 2>&1 | tail -10`
Expected: same failures as Task 1 plus none new (optional field).

- [ ] **Step 3: Commit**

```bash
git add src/server/events.ts
git commit -m "feat(events): tag session-token events with provider"
```

---

## Task 3 — Snapshot loader projects legacy fields into new shape

**Files:**
- Modify: `src/server/event-store.ts:285-291` (snapshot loadSnapshot chat hydrate)

- [ ] **Step 1: Add legacy projection in `loadSnapshot`**

Replace the `for (const chat of parsed.chats)` block (around line 285) with logic that reads any legacy `sessionToken` / `pendingForkSessionToken` and projects them:

```ts
for (const chat of parsed.chats) {
  const legacy = chat as unknown as {
    sessionToken?: string | null
    pendingForkSessionToken?: string | null
    sessionTokensByProvider?: Partial<Record<AgentProvider, string | null>>
  }
  const sessionTokensByProvider: Partial<Record<AgentProvider, string | null>> =
    legacy.sessionTokensByProvider
      ? { ...legacy.sessionTokensByProvider }
      : {}
  if (
    legacy.sessionToken != null
    && chat.provider
    && sessionTokensByProvider[chat.provider] == null
  ) {
    sessionTokensByProvider[chat.provider] = legacy.sessionToken
  }
  let pendingForkSessionToken: ChatRecord["pendingForkSessionToken"] = null
  if (chat.pendingForkSessionToken && typeof chat.pendingForkSessionToken === "object" && "token" in chat.pendingForkSessionToken) {
    pendingForkSessionToken = chat.pendingForkSessionToken as { provider: AgentProvider; token: string }
  } else if (typeof legacy.pendingForkSessionToken === "string" && chat.provider) {
    pendingForkSessionToken = { provider: chat.provider, token: legacy.pendingForkSessionToken }
  }
  const {
    sessionToken: _legacySessionToken,
    pendingForkSessionToken: _legacyPendingForkSessionToken,
    ...rest
  } = chat as typeof chat & {
    sessionToken?: string | null
    pendingForkSessionToken?: string | null | { provider: AgentProvider; token: string }
  }
  this.state.chatsById.set(chat.id, {
    ...rest,
    unread: chat.unread ?? false,
    sessionTokensByProvider,
    pendingForkSessionToken,
  } as ChatRecord)
}
```

The destructure intentionally drops legacy scalar token fields from the runtime object; do not rely on `as ChatRecord` to remove fields at runtime.

- [ ] **Step 2: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(event-store): migrate legacy snapshot chat tokens"
```

---

## Task 4 — Replay attribution for legacy token events

**Files:**
- Modify: `src/server/event-store.ts:495-695` (applyEvent)

- [ ] **Step 1: Track replay provider per chat**

In `EventStore`, add a private field at the class level for replay state:

```ts
private replayChatProvider: Map<string, AgentProvider | null> = new Map()
```

- [ ] **Step 2: Anchor on `chat_provider_set` and reset on `chat_created`**

In `applyEvent`, extend the existing handlers (lines 580-586 and the chat_created handler):

```ts
case "chat_created": {
  // ... existing code that inserts ChatRecord with sessionTokensByProvider: {}
  this.replayChatProvider.set(e.chatId, null)
  break
}
case "chat_provider_set": {
  const chat = this.state.chatsById.get(e.chatId)
  if (!chat) break
  chat.provider = e.provider
  chat.updatedAt = e.timestamp
  this.replayChatProvider.set(e.chatId, e.provider)
  break
}
```

In the `chat_created` initializer, set `sessionTokensByProvider: {}` and `pendingForkSessionToken: null`.

- [ ] **Step 3: Replace `session_token_set` handler (line 675)**

```ts
case "session_token_set": {
  const chat = this.state.chatsById.get(e.chatId)
  if (!chat) break
  const provider = e.provider ?? this.replayChatProvider.get(e.chatId) ?? chat.provider
  if (!provider) break
  chat.sessionTokensByProvider = {
    ...chat.sessionTokensByProvider,
    [provider]: e.sessionToken,
  }
  chat.updatedAt = e.timestamp
  break
}
```

- [ ] **Step 4: Replace `pending_fork_session_token_set` handler (line 689)**

```ts
case "pending_fork_session_token_set": {
  const chat = this.state.chatsById.get(e.chatId)
  if (!chat) break
  if (e.pendingForkSessionToken == null) {
    chat.pendingForkSessionToken = null
  } else {
    const provider = e.provider ?? this.replayChatProvider.get(e.chatId) ?? chat.provider
    if (!provider) break
    chat.pendingForkSessionToken = { provider, token: e.pendingForkSessionToken }
  }
  chat.updatedAt = e.timestamp
  break
}
```

- [ ] **Step 5: Clear replay map after replay completes**

At the end of `replayLogs` (around line 445), after `.forEach`:

```ts
this.replayChatProvider.clear()
```

- [ ] **Step 6: Run typecheck and existing event-store tests**

Run: `bun test src/server/event-store.test.ts 2>&1 | tail -20`
Expected: some failures expected — Task 1's shape change broke read sites. Continue; new test coverage added in Task 5.

- [ ] **Step 7: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(event-store): attribute legacy token events on replay"
```

---

## Task 5 — Replay attribution tests

**Files:**
- Modify: `src/server/event-store.test.ts`

- [ ] **Step 1: Write failing test for legacy event attribution**

Add to `src/server/event-store.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { EventStore } from "./event-store"

describe("replay attribution for session tokens", () => {
  async function makeStore() {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-replay-"))
    await mkdir(path.join(dir, "logs"), { recursive: true })
    return { dir, store: new EventStore(dir) }
  }

  test("legacy session_token_set attributes to chat.provider at time of event", async () => {
    const { dir } = await makeStore()
    const project = "p1"
    const chat = "c1"
    const now = 1000
    const lines = [
      { v: 3, type: "project_opened", timestamp: now, projectId: project, localPath: "/tmp/x", title: "x" },
      { v: 3, type: "chat_created", timestamp: now + 1, chatId: chat, projectId: project, title: "t" },
      { v: 3, type: "chat_provider_set", timestamp: now + 2, chatId: chat, provider: "claude" },
      { v: 3, type: "session_token_set", timestamp: now + 3, chatId: chat, sessionToken: "tok-claude-1" },
      { v: 3, type: "chat_provider_set", timestamp: now + 4, chatId: chat, provider: "codex" },
      { v: 3, type: "session_token_set", timestamp: now + 5, chatId: chat, sessionToken: "tok-codex-1" },
    ]
    await writeFile(path.join(dir, "logs", "projects.jsonl"), lines.slice(0, 1).map((l) => JSON.stringify(l)).join("\n") + "\n")
    await writeFile(path.join(dir, "logs", "chats.jsonl"), lines.slice(1, 5).filter((l) => l.type !== "session_token_set").map((l) => JSON.stringify(l)).join("\n") + "\n")
    await writeFile(path.join(dir, "logs", "turns.jsonl"), lines.filter((l) => l.type === "session_token_set").map((l) => JSON.stringify(l)).join("\n") + "\n")
    const store = new EventStore(dir)
    await store.ready()
    const record = store.getChat(chat)!
    expect(record.sessionTokensByProvider.claude).toBe("tok-claude-1")
    expect(record.sessionTokensByProvider.codex).toBe("tok-codex-1")
    await rm(dir, { recursive: true, force: true })
  })

  test("new session_token_set with explicit provider writes to that slot", async () => {
    const { dir } = await makeStore()
    const project = "p1"
    const chat = "c1"
    const now = 1000
    const events = [
      { v: 3, type: "project_opened", timestamp: now, projectId: project, localPath: "/tmp/x", title: "x" },
      { v: 3, type: "chat_created", timestamp: now + 1, chatId: chat, projectId: project, title: "t" },
      { v: 3, type: "chat_provider_set", timestamp: now + 2, chatId: chat, provider: "claude" },
      { v: 3, type: "session_token_set", timestamp: now + 3, chatId: chat, sessionToken: "x-codex", provider: "codex" },
    ]
    await writeFile(path.join(dir, "logs", "projects.jsonl"), JSON.stringify(events[0]) + "\n")
    await writeFile(path.join(dir, "logs", "chats.jsonl"), events.slice(1, 3).map((e) => JSON.stringify(e)).join("\n") + "\n")
    await writeFile(path.join(dir, "logs", "turns.jsonl"), JSON.stringify(events[3]) + "\n")
    const store = new EventStore(dir)
    await store.ready()
    const record = store.getChat(chat)!
    expect(record.sessionTokensByProvider.codex).toBe("x-codex")
    expect(record.sessionTokensByProvider.claude).toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })

  test("legacy pending_fork_session_token_set becomes provider-tagged", async () => {
    const { dir } = await makeStore()
    const chat = "c1"
    const project = "p1"
    const now = 1000
    await writeFile(path.join(dir, "logs", "projects.jsonl"), JSON.stringify({ v: 3, type: "project_opened", timestamp: now, projectId: project, localPath: "/tmp/x", title: "x" }) + "\n")
    await writeFile(path.join(dir, "logs", "chats.jsonl"), [
      { v: 3, type: "chat_created", timestamp: now + 1, chatId: chat, projectId: project, title: "t" },
      { v: 3, type: "chat_provider_set", timestamp: now + 2, chatId: chat, provider: "claude" },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n")
    await writeFile(path.join(dir, "logs", "turns.jsonl"), JSON.stringify({ v: 3, type: "pending_fork_session_token_set", timestamp: now + 3, chatId: chat, pendingForkSessionToken: "fork-tok" }) + "\n")
    const store = new EventStore(dir)
    await store.ready()
    const record = store.getChat(chat)!
    expect(record.pendingForkSessionToken).toEqual({ provider: "claude", token: "fork-tok" })
    await rm(dir, { recursive: true, force: true })
  })
})
```

If `EventStore` has no `getChat` public method, add one:

```ts
getChat(chatId: string): ChatRecord | undefined {
  return this.state.chatsById.get(chatId)
}
```

- [ ] **Step 2: Run tests, verify red**

Run: `bun test src/server/event-store.test.ts 2>&1 | tail -20`
Expected: 3 new tests fail (or rely on existing handlers — should pass if Task 4 done; in that case verify they pass).

- [ ] **Step 3: Make any handler fixes uncovered by tests until green**

Run: `bun test src/server/event-store.test.ts`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/event-store.test.ts src/server/event-store.ts
git commit -m "test(event-store): legacy token attribution + provider-tagged writes"
```

---

## Task 6 — Per-provider setters in `EventStore`

**Files:**
- Modify: `src/server/event-store.ts:1327-1371`

- [ ] **Step 1: Replace `setSessionToken` with provider-aware setter**

In `src/server/event-store.ts`, replace `setSessionToken` (line 1327):

```ts
async setSessionTokenForProvider(
  chatId: string,
  provider: AgentProvider,
  sessionToken: string | null,
) {
  const chat = this.requireChat(chatId)
  if ((chat.sessionTokensByProvider[provider] ?? null) === sessionToken) return
  const event: TurnEvent = {
    v: STORE_VERSION,
    type: "session_token_set",
    timestamp: Date.now(),
    chatId,
    sessionToken,
    provider,
  }
  await this.append(this.turnsLogPath, event)
}
```

Keep the existing setter pattern: `append()` applies the event after writing the log (`event-store.ts:798-804`), so do not call `applyEvent` again.

- [ ] **Step 2: Replace `setPendingForkSessionToken` with provider-aware**

```ts
async setPendingForkSessionToken(
  chatId: string,
  value: { provider: AgentProvider; token: string } | null,
) {
  const chat = this.requireChat(chatId)
  const current = chat.pendingForkSessionToken
  const same =
    (current == null && value == null)
    || (current != null && value != null && current.provider === value.provider && current.token === value.token)
  if (same) return
  const event: TurnEvent = {
    v: STORE_VERSION,
    type: "pending_fork_session_token_set",
    timestamp: Date.now(),
    chatId,
    pendingForkSessionToken: value?.token ?? null,
    provider: value?.provider,
  }
  await this.append(this.turnsLogPath, event)
}
```

- [ ] **Step 3: Update `forkChat` (line 1040)**

The old code reads `sourceChat.sessionToken ?? sourceChat.pendingForkSessionToken`. Replace with provider-aware:

```ts
const sourceProvider = sourceChat.provider
if (!sourceProvider) throw new Error("Chat cannot be forked")
const sourceToken =
  sourceChat.sessionTokensByProvider[sourceProvider]
  ?? (sourceChat.pendingForkSessionToken?.provider === sourceProvider
    ? sourceChat.pendingForkSessionToken.token
    : null)
if (!sourceToken) throw new Error("Chat cannot be forked")
// ... existing chat_created append ...
await this.setChatProvider(chatId, sourceProvider)
await this.setPlanMode(chatId, sourceChat.planMode)
await this.setPendingForkSessionToken(chatId, { provider: sourceProvider, token: sourceToken })
```

- [ ] **Step 4: Run event-store tests**

Run: `bun test src/server/event-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/event-store.ts
git commit -m "feat(event-store): provider-aware session token setters"
```

---

## Task 7 — History primer builder

**Files:**
- Create: `src/server/history-primer.ts`
- Create: `src/server/history-primer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/history-primer.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import type { TranscriptEntry, AgentProvider } from "../shared/types"
import { buildHistoryPrimer, PRIMER_MAX_CHARS, shouldInjectPrimer } from "./history-primer"

function userEntry(text: string, createdAt: number): TranscriptEntry {
  return { _id: `u-${createdAt}`, kind: "user_prompt", createdAt, content: text }
}

function assistantEntry(text: string, createdAt: number): TranscriptEntry {
  return { _id: `a-${createdAt}`, kind: "assistant_text", createdAt, text }
}

describe("shouldInjectPrimer", () => {
  test("returns true when target provider has no token", () => {
    expect(shouldInjectPrimer({ claude: "x" }, "codex", false)).toBe(true)
  })

  test("returns false when target provider has a token", () => {
    expect(shouldInjectPrimer({ claude: "x" }, "claude", false)).toBe(false)
  })

  test("returns true when userClearedContext is true regardless of token", () => {
    expect(shouldInjectPrimer({ claude: "x" }, "claude", true)).toBe(true)
  })

  test("returns true for first-ever chat (empty map)", () => {
    expect(shouldInjectPrimer({}, "claude", false)).toBe(true)
  })
})

describe("buildHistoryPrimer", () => {
  test("returns null when no assistant entries exist", () => {
    const entries: TranscriptEntry[] = [userEntry("hi", 1000)]
    expect(buildHistoryPrimer(entries, "codex" as AgentProvider, "next")).toBeNull()
  })

  test("renders user + assistant entries in order", () => {
    const entries: TranscriptEntry[] = [
      userEntry("first", 1000),
      assistantEntry("reply", 2000),
    ]
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "now what?")!
    expect(primer).toContain("BEGIN PRIOR CONVERSATION")
    expect(primer).toContain("first")
    expect(primer).toContain("reply")
    expect(primer).toContain("END PRIOR CONVERSATION")
    expect(primer.endsWith("now what?")).toBe(true)
  })

  test("truncates oldest entries when over PRIMER_MAX_CHARS", () => {
    const entries: TranscriptEntry[] = []
    for (let i = 0; i < 200; i += 1) {
      entries.push(userEntry("u".repeat(800), i * 2))
      entries.push(assistantEntry("a".repeat(800), i * 2 + 1))
    }
    const primer = buildHistoryPrimer(entries, "codex" as AgentProvider, "tail")!
    expect(primer.length).toBeLessThanOrEqual(PRIMER_MAX_CHARS + 200)
    expect(primer).toContain("earlier conversation omitted")
  })
})
```

- [ ] **Step 2: Run tests, verify red**

Run: `bun test src/server/history-primer.test.ts 2>&1 | tail -20`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `history-primer.ts`**

Create `src/server/history-primer.ts`:

```ts
import type { AgentProvider, TranscriptEntry } from "../shared/types"

export const PRIMER_MAX_CHARS = 60_000

export function shouldInjectPrimer(
  sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>,
  targetProvider: AgentProvider,
  userClearedContext: boolean,
): boolean {
  if (userClearedContext) return true
  return sessionTokensByProvider[targetProvider] == null
}

interface RenderedEntry {
  text: string
  createdAt: number
}

function renderEntry(entry: TranscriptEntry): RenderedEntry | null {
  const ts = new Date(entry.createdAt).toISOString().replace("T", " ").slice(0, 19)
  if (entry.kind === "user_prompt") {
    return { text: `[user, ${ts}]\n${entry.content}\n`, createdAt: entry.createdAt }
  }
  if (entry.kind === "assistant_text") {
    return { text: `[assistant, ${ts}]\n${entry.text}\n`, createdAt: entry.createdAt }
  }
  if (entry.kind === "tool_call") {
    return { text: `[tool, ${ts}] ${entry.tool.toolName}\n`, createdAt: entry.createdAt }
  }
  return null
}

export function buildHistoryPrimer(
  entries: TranscriptEntry[],
  _targetProvider: AgentProvider,
  userText: string,
): string | null {
  const hasAssistant = entries.some((entry) => entry.kind === "assistant_text")
  if (!hasAssistant) return null

  const rendered = entries
    .map(renderEntry)
    .filter((entry): entry is RenderedEntry => entry !== null)

  const header = "The following is the prior conversation in this chat. The first part is context only; the actual request follows after the marker line.\n\n--- BEGIN PRIOR CONVERSATION ---\n"
  const footer = "--- END PRIOR CONVERSATION ---\n\n"
  const tail = userText
  const overhead = header.length + footer.length + tail.length
  const budget = Math.max(0, PRIMER_MAX_CHARS - overhead)

  const selected: RenderedEntry[] = []
  let used = 0
  let truncated = false
  for (let i = rendered.length - 1; i >= 0; i -= 1) {
    const entry = rendered[i]
    if (used + entry.text.length > budget) {
      truncated = i > 0
      break
    }
    selected.unshift(entry)
    used += entry.text.length
  }

  const truncMarker = truncated ? "[... earlier conversation omitted ...]\n" : ""
  return `${header}${truncMarker}${selected.map((entry) => entry.text).join("")}${footer}${tail}`
}
```

- [ ] **Step 4: Run tests, verify green**

Run: `bun test src/server/history-primer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/history-primer.ts src/server/history-primer.test.ts
git commit -m "feat(history-primer): build cross-provider preamble"
```

---

## Task 8 — Wire primer + per-provider tokens into `startTurnForChat`

**Files:**
- Modify: `src/server/agent.ts:1213-1275` (Claude/Codex branches in `startTurnForChat`)
- Modify: `src/server/agent.ts:1567-1737` (event handlers that call `setSessionToken`)

- [ ] **Step 1: Replace `chat.sessionToken` reads in start path**

In `src/server/agent.ts` around line 1229 (Claude) and 1250 (Codex):

```ts
// Claude branch
const targetProvider: AgentProvider = args.provider
const existingToken = chat.sessionTokensByProvider[targetProvider] ?? null
const pendingFork = chat.pendingForkSessionToken?.provider === targetProvider
  ? chat.pendingForkSessionToken.token
  : null
turn = await this.startClaudeTurn({
  // ...
  sessionToken: pendingFork ?? existingToken,
  forkSession: pendingFork != null,
  // ...
})
```

For the Codex branch, the same pattern. Replace `chat.sessionToken` → `existingToken`, `chat.pendingForkSessionToken` → `pendingFork`. Pass them positionally as `codexManager.startSession` expects.

Also when clearing the pending fork at line 1254:

```ts
if (pendingFork && sessionToken) {
  await this.store.setPendingForkSessionToken(args.chatId, null)
}
```

- [ ] **Step 2: Build + inject primer when needed**

Before `startClaudeTurn` / `startCodexTurn` calls, compute the primer from `existingMessages`, which was captured before appending the current user prompt. Do not call `this.store.getMessages(args.chatId)` here after `appendUserPrompt`, or the current request can appear once in the primer and again as the actual request:

```ts
const shouldPrime = shouldInjectPrimer(
  chat.sessionTokensByProvider,
  targetProvider,
  Boolean(args.userClearedContext),
)
const primer = shouldPrime
  ? buildHistoryPrimer(
      existingMessages,
      targetProvider,
      buildPromptText(args.content, args.attachments),
    )
  : null
const promptContent = primer ?? buildPromptText(args.content, args.attachments)
```

Then use `promptContent` in the provider prompt send sites:

- Claude: `session.session.sendPrompt(promptContent)` at the post-`startClaudeTurn` send point.
- Codex: `codexManager.startTurn({ content: promptContent, ... })`.

Imports at top of `agent.ts`:

```ts
import { buildHistoryPrimer, shouldInjectPrimer } from "./history-primer"
```

`args.userClearedContext` is a new optional bool on `StartTurnArgs`. Add to the type definition where `StartTurnArgs` is declared (search for `interface StartTurnArgs` in `agent.ts`):

```ts
userClearedContext?: boolean
```

Pass through from `sendMessage` callers. The current "Clear context" code path is owned by `chat.markRead`-adjacent handlers; if no caller sets it yet, default `false` is correct for phase 1 ship — the natural primer trigger (provider-switch with no token) still fires.

- [ ] **Step 3: Update token-set handlers (lines 1584-1586, 1733-1737)**

Wherever `await this.store.setSessionToken(chatId, token)` appears (event-store call), replace with the provider-aware variant. Two known sites:

```ts
// line 1584-1586 area
if (event.type === "session_token" && event.sessionToken) {
  session.sessionToken = event.sessionToken
  await this.store.setSessionTokenForProvider(session.chatId, session.provider, event.sessionToken)
}

// line 1733-1737 area
if (event.type === "session_token" && event.sessionToken) {
  await this.store.setSessionTokenForProvider(active.chatId, active.provider, event.sessionToken)
  // ...
}
```

`session.provider` / `active.provider` already exist on those structs (lines 1278-1279 confirm `ActiveTurn` has `provider`).

- [ ] **Step 4: Update clear-context token clearing**

The exit-plan clear-context path currently calls `setSessionToken(command.chatId, null)`. Replace it with a provider-aware clear for the active turn:

```ts
await this.store.setSessionTokenForProvider(command.chatId, active.provider, null)
```

Keep the existing `context_cleared` transcript entry. This is what makes the next turn on the same provider prime from transcript history again.

- [ ] **Step 5: Update `ensureSlashCommandsLoaded` (line 1008)**

```ts
sessionToken: chat.sessionTokensByProvider.claude ?? null,
```

- [ ] **Step 6: Typecheck**

Run: `bun run check 2>&1 | tail -20`
Expected: no errors from `agent.ts`. Other files may still error — addressed in later tasks.

- [ ] **Step 7: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): per-provider session tokens + history primer"
```

---

## Task 9 — Agent tests for primer + token routing

**Files:**
- Modify: `src/server/agent.test.ts`

- [ ] **Step 1: Add primer-injection test**

Add to `src/server/agent.test.ts` (use existing harness helpers — search the file for `function createAgent` or similar setup):

```ts
test("primer is injected when switching to provider with no token", async () => {
  const { agent, store, chatId } = await setupChatWithAssistantTurn({ provider: "claude" })
  // Switch composer to codex
  const startSpy = mockProviderStart(agent, "codex")
  await agent.sendMessage({
    chatId,
    provider: "codex",
    content: "continue please",
    model: "gpt-5.5",
  })
  expect(startSpy).toHaveBeenCalledTimes(1)
  const promptArg = startSpy.mock.calls[0][0].content
  expect(promptArg).toContain("BEGIN PRIOR CONVERSATION")
  expect(promptArg.endsWith("continue please")).toBe(true)
})

test("no primer when target provider already has a token", async () => {
  const { agent, store, chatId } = await setupChatWithAssistantTurn({ provider: "claude" })
  // simulate codex previously seen
  await store.setSessionTokenForProvider(chatId, "codex", "tok-codex")
  const startSpy = mockProviderStart(agent, "codex")
  await agent.sendMessage({ chatId, provider: "codex", content: "hi", model: "gpt-5.5" })
  const promptArg = startSpy.mock.calls[0][0].content
  expect(promptArg).not.toContain("BEGIN PRIOR CONVERSATION")
  expect(promptArg).toBe("hi")
})

test("first-ever turn skips primer even when token is null", async () => {
  const { agent, chatId } = await setupEmptyChat({ provider: "claude" })
  const startSpy = mockProviderStart(agent, "claude")
  await agent.sendMessage({ chatId, provider: "claude", content: "hello", model: "claude-opus-4-7" })
  const promptArg = startSpy.mock.calls[0][0].content
  expect(promptArg).not.toContain("BEGIN PRIOR CONVERSATION")
  expect(promptArg).toBe("hello")
})

test("session_token_set carries provider on new write", async () => {
  const { agent, store, chatId } = await setupEmptyChat({ provider: "claude" })
  await simulateClaudeTurn(agent, chatId, { sessionToken: "tok-claude-new" })
  const record = store.getChat(chatId)!
  expect(record.sessionTokensByProvider.claude).toBe("tok-claude-new")
})
```

If the harness helpers (`setupChatWithAssistantTurn`, `mockProviderStart`, `simulateClaudeTurn`, `setupEmptyChat`) don't exist, build them by reading existing tests in `agent.test.ts` and reusing their fixture pattern. The point is: drive `Agent.sendMessage` and assert what reaches the underlying provider start fn.

- [ ] **Step 2: Run tests, verify green**

Run: `bun test src/server/agent.test.ts 2>&1 | tail -20`
Expected: 4 new tests PASS. Any other regressions in `agent.test.ts` must be triaged before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/server/agent.test.ts
git commit -m "test(agent): primer injection + per-provider token writes"
```

---

## Task 10 — Update `canForkChat` and read-model projection

**Files:**
- Modify: `src/server/read-models.ts:34-44, 271`
- Modify: `src/shared/types.ts:1207-1218` (ChatRuntime)
- Modify: `src/server/read-models.test.ts`

- [ ] **Step 1: Replace `canForkChat`**

Edit `src/server/read-models.ts` line 34:

```ts
function canForkChat(
  chat: ChatRecord,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
) {
  if (!chat.provider) return false
  const hasAnyToken = Object.values(chat.sessionTokensByProvider).some(Boolean)
  if (!hasAnyToken && chat.pendingForkSessionToken == null) return false
  if (activeStatuses.has(chat.id)) return false
  if (drainingChatIds.has(chat.id)) return false
  return true
}
```

- [ ] **Step 2: Update `ChatRuntime` shape**

Edit `src/shared/types.ts:1216`:

```ts
sessionTokensByProvider: Partial<Record<AgentProvider, string | null>>
```

Replace `sessionToken: string | null`.

- [ ] **Step 3: Update read-model projection**

Edit `src/server/read-models.ts:271`. Replace `sessionToken: chat.sessionToken` with:

```ts
sessionTokensByProvider: { ...chat.sessionTokensByProvider },
```

- [ ] **Step 4: Update existing `read-models.test.ts` callsites**

Anywhere a test fixture builds a `ChatRecord` with `sessionToken: ...`, replace with `sessionTokensByProvider: { claude: "..." }` (use the chat's `provider` value as the key).

- [ ] **Step 5: Add `canForkChat` tests**

```ts
test("canForkChat returns true when any provider slot has a token", () => {
  const chat = makeChat({ provider: "claude", sessionTokensByProvider: { codex: "x" } })
  expect(canForkChat(chat, new Map(), new Set())).toBe(true)
})

test("canForkChat returns true when pendingForkSessionToken is set", () => {
  const chat = makeChat({
    provider: "claude",
    sessionTokensByProvider: {},
    pendingForkSessionToken: { provider: "claude", token: "x" },
  })
  expect(canForkChat(chat, new Map(), new Set())).toBe(true)
})

test("canForkChat returns false when no tokens anywhere", () => {
  const chat = makeChat({ provider: "claude", sessionTokensByProvider: {} })
  expect(canForkChat(chat, new Map(), new Set())).toBe(false)
})
```

If `canForkChat` is not exported, export it from `read-models.ts`.

- [ ] **Step 6: Run tests**

Run: `bun test src/server/read-models.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/read-models.ts src/server/read-models.test.ts src/shared/types.ts
git commit -m "feat(read-models): fork affordance reads provider map"
```

---

## Task 11 — Client `useKannaState` equality + new shape

**Files:**
- Modify: `src/client/app/useKannaState.ts:38`
- Modify: `src/client/app/useKannaState.test.ts:283, 316, 457`

- [ ] **Step 1: Update equality**

`src/client/app/useKannaState.ts` line 38:

```ts
// BEFORE
&& left.sessionToken === right.sessionToken

// AFTER
&& shallowProviderTokenEquals(left.sessionTokensByProvider, right.sessionTokensByProvider)
```

Add helper above the equality function:

```ts
function shallowProviderTokenEquals(
  a: Partial<Record<AgentProvider, string | null>>,
  b: Partial<Record<AgentProvider, string | null>>,
) {
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key as AgentProvider] !== b[key as AgentProvider]) return false
  }
  return true
}
```

Import `AgentProvider` from `../../shared/types`.

- [ ] **Step 2: Update test fixtures**

In `src/client/app/useKannaState.test.ts`, lines 283, 316, 457 — replace `sessionToken: null` with `sessionTokensByProvider: {}` on the `ChatRuntime` fixture.

- [ ] **Step 3: Add composer-switch-without-mutation test**

```ts
test("composer provider switch updates composerState only, not runtime", () => {
  const { result } = renderHook(() => useKannaState())
  act(() => {
    result.current.setChatComposerModel("chat-1", "gpt-5.5")
  })
  expect(result.current.chat?.runtime.sessionTokensByProvider).toEqual({})
})
```

Adapt to actual hook surface; the point is: composer changes don't write to `sessionTokensByProvider`.

- [ ] **Step 4: Run tests**

Run: `bun test src/client/app/useKannaState.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/app/useKannaState.ts src/client/app/useKannaState.test.ts
git commit -m "feat(useKannaState): provider-token map equality"
```

---

## Task 12 — Drop `providerLocked` from `ChatInput`

**Files:**
- Modify: `src/client/components/chat-ui/ChatInput.tsx:230-232, 987-1000`
- Modify: `src/client/components/chat-ui/ChatPreferenceControls.tsx:145, 162, 188`
- Modify: `src/client/app/SettingsPage.tsx:1935, 1966`

- [ ] **Step 1: Remove `providerLocked` derivation in `ChatInput`**

Edit `src/client/components/chat-ui/ChatInput.tsx` line 230:

```ts
// REMOVE
const providerLocked = activeProvider !== null

// REPLACE references:
const selectedProvider = composerState.provider
```

Around line 987-1000:

```tsx
<ChatPreferenceControls
  availableProviders={availableProviders}
  selectedProvider={selectedProvider}
  showCodexCliRequirementHints
  model={providerPrefs.model}
  modelOptions={providerPrefs.modelOptions}
  onProviderChange={(provider) => {
    resetChatComposerFromProvider(composerChatId, provider)
  }}
  onModelChange={(_, model) => {
    setChatComposerModel(composerChatId, model)
  }}
  // ... existing onModelOptionChange unchanged
/>
```

The `if (providerLocked)` branches inside the callbacks are dead — delete them.

Before deleting, run `rg -n "activeProvider|providerLocked" src/client/components/chat-ui/ChatInput.tsx` and verify each usage is specifically a first-turn provider lock, not a separate "active turn is running" guard. Preserve any non-lock disabling behavior under a clearer name if found.

- [ ] **Step 2: Remove `providerLocked` prop from `ChatPreferenceControls`**

Edit `src/client/components/chat-ui/ChatPreferenceControls.tsx`. Remove `providerLocked?: boolean` from the props interface (line 145), remove the destructure default (line 162), and remove the `disabled={providerLocked || !onProviderChange}` clause (line 188) — keep only `disabled={!onProviderChange}`.

- [ ] **Step 3: Remove `providerLocked` callsites in `SettingsPage`**

Edit `src/client/app/SettingsPage.tsx` lines 1935 and 1966 — delete the `providerLocked` line in each `<ChatPreferenceControls>` block. Settings page uses the controls in non-chat context where lock is irrelevant; the field is being deleted.

- [ ] **Step 4: Typecheck**

Run: `bun run check 2>&1 | tail -10`
Expected: PASS for these files. Any new error means a missed callsite — fix it.

- [ ] **Step 5: Manual smoke test**

Run: `bun run dev` (background). Open chat, send a message under Claude. After response arrives, change model selector to Codex. Send again. Expect the next turn to go to Codex (verify via dev tools network log) without a banner blocking the selector.

If `bun run dev` is unavailable in CI, skip and rely on tests.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/chat-ui/ChatInput.tsx src/client/components/chat-ui/ChatPreferenceControls.tsx src/client/app/SettingsPage.tsx
git commit -m "feat(chat-input): unlock provider/model selector mid-conversation"
```

---

## Task 13 — Codex + Claude session adapters use new shape

**Files:**
- Modify: `src/server/codex-app-server.ts` (search for `sessionToken` field reads)
- Modify: `src/server/claude-session-importer.ts` (writes during import)

- [ ] **Step 1: Update Codex callsites**

Run: `bun run check 2>&1 | grep codex-app-server` — fix every reported error. The contract: `startSession` receives `sessionToken` + `pendingForkSessionToken` from the agent (already provider-tagged at the call site in Task 8). Internal storage may stay scalar — Codex manager owns one provider.

Confirm no `chat.sessionToken` access remains: `grep -n 'chat\.sessionToken' src/server/codex-app-server.ts` — every hit must read from `args.sessionToken` (the value passed in by the agent), not from `ChatRecord`.

- [ ] **Step 2: Update Claude importer**

In `src/server/claude-session-importer.ts`, wherever an imported session writes a token to the store, route it through `setSessionTokenForProvider(chatId, "claude", token)` instead of `setSessionToken(chatId, token)`.

- [ ] **Step 3: Run targeted tests**

Run: `bun test src/server/codex-app-server.test.ts src/server/claude-session-importer.test.ts`
Expected: PASS. Update test fixtures that hardcode old shape.

- [ ] **Step 4: Commit**

```bash
git add src/server/codex-app-server.ts src/server/claude-session-importer.ts src/server/codex-app-server.test.ts src/server/claude-session-importer.test.ts
git commit -m "feat(adapters): codex + claude importer use provider-tagged tokens"
```

---

## Task 14 — Full test sweep + manual smoke

**Files:** (none; verification)

- [ ] **Step 1: Run full test suite**

Run: `bun test 2>&1 | tail -20`
Expected: ALL PASS. If anything fails, isolate the file and fix the call site — no test skipping.

- [ ] **Step 2: Run typecheck**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 3: Manual provider-switch smoke (if dev server reachable)**

Run: `bun run dev`

1. Open existing chat with Claude assistant reply.
2. Switch model selector to Codex.
3. Send "summarize the conversation".
4. Verify Codex receives a primer (server logs should show `buildHistoryPrimer` invocation OR inspect provider request payload).
5. Switch back to Claude. Send another message.
6. Verify NO primer this time (Claude already has a token).
7. Use "Clear context" on the chat (if available in UI). Send again.
8. Verify primer re-injected.

If any step deviates from spec, file a bug and stop.

- [ ] **Step 4: Commit (no-op or smoke notes)**

If smoke surfaces a fix, commit it. Otherwise no commit needed.

- [ ] **Step 5: Push branch**

```bash
git push -u origin plans/model-independent-chat
```

---

## Open follow-ups (not phase 1)

- `userClearedContext` UI affordance — currently wired through arg, no UI control yet. Tracked in phase-1 spec under "Open items resolved" but UI is deferred.
- Provider-tagged telemetry on primer builds — wire when telemetry sink is finalized.
- Auto-summarization on primer overflow — phase 1 ships hard cap + truncation marker only.

---

## Self-review checklist

- [ ] Every reference to `chat.sessionToken` (server + client) eliminated except inside legacy snapshot/event projections.
- [ ] `STORE_VERSION` unchanged (stays at 3).
- [ ] `forkChat` writes `{ provider, token }` to pending fork.
- [ ] `canForkChat` returns true when ANY slot has a token.
- [ ] `buildHistoryPrimer` returns `null` for empty assistant history.
- [ ] `bun test` and `bun run check` both pass.
