# PR A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side single-session import: `importOneSession` extraction, UUID locator, and the `sessions.importClaudeSession { sessionIds: string[] }` command — no UI change.

**Architecture:** Extract the per-session body of the bulk importer into `importOneSession`; add a pure UUID extractor (shared) and an O(#dirs) file locator (adapter); add one WS command whose handler composes locate → parse → importOneSession per id and exposes an optional `onSessionImported` callback seam for PR C.

**Tech Stack:** Bun + TypeScript, Kanna EventStore, bun test (`--conditions production`).

## Global Constraints

- Repo: `/Users/home/repos/kanna`, branch off `main`; PR targets `cuongtranba/kanna` (`gh pr create --repo cuongtranba/kanna`).
- WALL: every existing test in `src/server/claude-session-{importer,scanner,parser,mapper}.test.ts` passes **unmodified**.
- `bun run test` and `bun run lint` (`--max-warnings=0`) green before every push; run single suites with `bun test --conditions production <file>`.
- Side-effect seal: filesystem IO only in `*.adapter.ts`; no `eslint-disable`.
- Commits: no agent co-author lines.
- C3: this PR carries the change-unit ADR (Task 1).

---

### Task 1: C3 ADR (change-unit)

**Files:**
- Create (via CLI only): `.c3/adr/adr-20260730-import-single-claude-session.md` + change-unit folder `.c3/changes/adr-20260730-import-single-claude-session/`

**Interfaces:**
- Produces: the ADR id `adr-20260730-import-single-claude-session` referenced by later `c3 change apply` (final kanna PR of the project).

- [x] **Step 1: Set up the c3 handle and read the ADR schema**

```bash
c3() { C3X_MODE=agent bash /Users/home/.claude/plugins/cache/c3-skill-marketplace/c3-skill/11.0.0/skills/c3/bin/c3x.sh "$@"; }
c3 schema adr
```

Read the REJECT IF block first; author the body to that contract (do not draft freehand).

- [x] **Step 2: Create the ADR**

`c3 add adr import-single-claude-session --file body.md` where `body.md` (write it in the scratchpad, not the repo) covers, per the schema's sections: context = this SPEC's §1 (cite `SPEC.md` in `~/Downloads/kanna-session-import/`); decision = D1/D2/D6 from SPEC §3; affected topology = c3-214 (discovery), c3-3 (protocol types), c3-117 (UI, later PR).

- [x] **Step 3: Author change-unit patches for the c3-214 doc drift**

`c3 change new adr-20260730-import-single-claude-session`, then author patches (per `references/change.md` flow) that: (a) fix c3-214's Contract/Change Safety rows citing `src/server/discovery.ts` → `src/server/discovery.adapter.ts`; (b) remove the "Filesystem watch triggers incremental rescan" claim (no watch exists); (c) add codemap bindings for `claude-session-importer.adapter.ts`, `claude-session-scanner.adapter.ts`, `claude-session-parser.adapter.ts`, `claude-session-mapper.ts` to c3-214. Do NOT `change apply` yet — patches land with the final kanna PR.

- [x] **Step 4: Validate and commit**

```bash
c3 check
git add .c3 && git commit -m "docs: ADR for single-session import (change-unit opened)"
```

### Task 2: `extractSessionId` (pure, shared)

**Files:**
- Create: `src/shared/claude-session-id.ts`
- Test: `src/shared/claude-session-id.test.ts`

**Interfaces:**
- Produces: `extractSessionId(input: string): string | null` — lowercase UUID or null. Also `extractSessionIds(input: string): string[]` — split on whitespace/commas/newlines, extract each, dedupe, drop nulls. PR B's dialog and Task 4's handler both consume these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// src/shared/claude-session-id.test.ts
import { describe, expect, test } from "bun:test"
import { extractSessionId, extractSessionIds } from "./claude-session-id"

const ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"

describe("extractSessionId", () => {
  test("bare uuid", () => expect(extractSessionId(` ${ID} `)).toBe(ID))
  test("uppercase normalized", () => expect(extractSessionId(ID.toUpperCase())).toBe(ID))
  test("filename", () => expect(extractSessionId(`${ID}.jsonl`)).toBe(ID))
  test("full path takes the basename uuid", () =>
    expect(extractSessionId(`/Users/x/.claude/projects/-Users-x-repos-kanna/${ID}.jsonl`)).toBe(ID))
  test("garbage returns null", () => expect(extractSessionId("not-a-uuid")).toBeNull())
  test("empty returns null", () => expect(extractSessionId("  ")).toBeNull())
})

describe("extractSessionIds", () => {
  test("splits on newlines/commas/spaces and dedupes", () => {
    const other = "0f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
    expect(extractSessionIds(`${ID},\n ${other} ${ID}`)).toEqual([ID, other])
  })
  test("empty input yields []", () => expect(extractSessionIds(" \n")).toEqual([]))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --conditions production src/shared/claude-session-id.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Minimal implementation**

```ts
// src/shared/claude-session-id.ts
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Extract a Claude session UUID from pasted text (bare id, filename, or path). */
export function extractSessionId(input: string): string | null {
  const matches = input.match(UUID_RE)
  if (!matches || matches.length === 0) return null
  // Last match wins: in a full path the session uuid is the basename.
  return matches[matches.length - 1].toLowerCase()
}

export function extractSessionIds(input: string): string[] {
  const out: string[] = []
  for (const token of input.split(/[\s,]+/)) {
    if (!token) continue
    const id = extractSessionId(token)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}
```

- [ ] **Step 4: Run to verify pass** — same command, Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/claude-session-id.ts src/shared/claude-session-id.test.ts
git commit -m "feat(shared): extract Claude session uuids from pasted text"
```

### Task 3: `locateClaudeSessionFile` (adapter)

**Files:**
- Modify: `src/server/claude-session-scanner.adapter.ts` (append function; do not touch `scanClaudeSessions`)
- Test: `src/server/claude-session-scanner.test.ts` (append cases; existing 2 cases unmodified)

**Interfaces:**
- Consumes: nothing new.
- Produces: `locateClaudeSessionFile(homeDir: string, sessionId: string): string | null` — absolute path of `~/.claude/projects/<any-dir>/<sessionId>.jsonl` or null. Task 4 consumes it.

- [ ] **Step 1: Write the failing test** (append to the existing describe-style; reuse the file's temp-dir setup helpers — the existing two cases show the pattern of building a fake `~/.claude/projects` tree under a tmpdir)

```ts
test("locateClaudeSessionFile finds the file in any project dir", () => {
  // arrange (mirror the existing test's tmp tree helper):
  // <tmp>/.claude/projects/dir-a/other.jsonl
  // <tmp>/.claude/projects/dir-b/4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f.jsonl
  const found = locateClaudeSessionFile(tmpHome, "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f")
  expect(found).toBe(join(tmpHome, ".claude", "projects", "dir-b", "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f.jsonl"))
})

test("locateClaudeSessionFile returns null when absent or projects dir missing", () => {
  expect(locateClaudeSessionFile(tmpHome, "00000000-0000-4000-8000-000000000000")).toBeNull()
  expect(locateClaudeSessionFile(join(tmpHome, "nope"), "00000000-0000-4000-8000-000000000000")).toBeNull()
})
```

- [ ] **Step 2: Run to verify fail** — `bun test --conditions production src/server/claude-session-scanner.test.ts` → FAIL (not exported).

- [ ] **Step 3: Minimal implementation** (append to the adapter)

```ts
/**
 * Locate one session's transcript by uuid: O(#project-dirs) existence checks,
 * never reads or hashes unrelated sessions (unlike scanClaudeSessions).
 */
export function locateClaudeSessionFile(homeDir: string, sessionId: string): string | null {
  const projectsDir = path.join(homeDir, ".claude", "projects")
  if (!existsSync(projectsDir)) return null
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}
```

- [ ] **Step 4: Run to verify pass** — same command; ALL cases (old + new) PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(server): locate one Claude session transcript by uuid"`

### Task 4: Extract `importOneSession` (refactor, wall-guarded)

**Files:**
- Modify: `src/server/claude-session-importer.adapter.ts`
- Test: `src/server/claude-session-importer.test.ts` — **must remain byte-identical** (`git diff --stat` shows no change to it).

**Interfaces:**
- Produces (exact, PR C and Task 5 consume):

```ts
export type ImportOutcome =
  | { status: "created"; chatId: string; newProject: boolean }
  | { status: "updated"; chatId: string }
  | { status: "skipped"; chatId?: string }
  | { status: "failed"; reason: "cwd_missing" | "store_error" }

export async function importOneSession(
  store: EventStore,
  session: ParsedClaudeSession,
): Promise<ImportOutcome>
```

- [ ] **Step 1: Snapshot the wall** — run `bun test --conditions production src/server/claude-session-importer.test.ts`; Expected: PASS (baseline, 10 cases).

- [ ] **Step 2: Extract.** Move the loop body of `importClaudeSessions` (current lines ~200–270: existing-chat lookup, `backfillImportedChatTitle`, hash-match skip, `applyDelta` + `setSourceHash`, cwd check, `mapClaudeRecordsToEntries` empty-skip, `openProject`/`createChat`/`setChatProvider`/`renameChat`/append/`setSessionTokenForProvider`/`setSourceHash`) into `importOneSession` returning `ImportOutcome`:
  - existing chat + hash match → `titleBackfilled ? {status:"updated",chatId} : {status:"skipped",chatId}`
  - existing chat + hash changed → delta; `appended>0 || titleBackfilled ? updated : skipped` (both carry chatId); always `setSourceHash`
  - store error on existing path → `{status:"failed",reason:"store_error"}` (keep the `console.error`)
  - `!cwdExists` → `{status:"failed",reason:"cwd_missing"}`
  - `entries.length===0` → `{status:"skipped"}` (no chatId)
  - fresh import → `{status:"created",chatId,newProject: projectBefore===undefined}`; store error → `{status:"failed",reason:"store_error"}`

  Rewrite the bulk loop to call it and map: created→`imported+=1` (+`newProjects+=1` when `newProject`); updated→`updated+=1`; skipped→`skipped+=1`; failed→`failed+=1`. Keep `onProgress` calls exactly where they are today (after scan-count increment; after a created outcome).

- [ ] **Step 3: Verify the wall** — rerun the importer suite AND `git diff --stat src/server/claude-session-importer.test.ts` (must be empty). Then full `bun run test`.

- [ ] **Step 4: Commit** — `git commit -m "refactor(server): extract importOneSession from bulk import loop"`

### Task 5: Command + handler + client hook

**Files:**
- Modify: `src/shared/protocol.ts` (ClientCommand union, near line 90)
- Modify: `src/server/claude-session-importer.adapter.ts` (add `importSessionsByIds`)
- Modify: `src/server/ws-router.ts` (new case after `sessions.importClaude`, line ~1610)
- Modify: `src/client/app/useKannaState.ts` (near `importClaudeSessions`, line ~2202)
- Test: `src/server/claude-session-importer.test.ts` — **append** a new `describe("importSessionsByIds")` block (appending new cases is allowed; existing cases untouched)

**Interfaces:**
- Consumes: `extractSessionId` (Task 2), `locateClaudeSessionFile` (Task 3), `importOneSession` (Task 4), `parseClaudeSessionFile` (existing).
- Produces (PR B + PR C consume these exact shapes):

```ts
// protocol.ts addition:
| { type: "sessions.importClaudeSession"; sessionIds: string[] }

// importer adapter additions:
export interface SingleImportResultRow {
  sessionId: string
  status: "created" | "updated" | "skipped" | "failed"
  chatId?: string
  title?: string
  error?: "invalid_id" | "not_found" | "cwd_missing" | "parse_failed" | "store_error"
}
export interface ImportSessionsByIdsResult { results: SingleImportResultRow[]; newProjects: number }
export interface SessionImportedInfo { chatId: string; sessionId: string; sourcePath: string; sourceMtimeMs: number }
export interface ImportSessionsByIdsArgs {
  store: EventStore
  sessionIds: string[]
  homeDir?: string
  onSessionImported?: (info: SessionImportedInfo) => void  // PR C's tail seam; unused here
}
export async function importSessionsByIds(args: ImportSessionsByIdsArgs): Promise<ImportSessionsByIdsResult>
```

- [ ] **Step 1: Write the failing tests** (append; reuse the store/tmp-home fixtures already built in this test file — same setup the bulk cases use)

```ts
describe("importSessionsByIds", () => {
  test("imports exactly one session and leaves siblings untouched", async () => {
    // tmp home containing TWO session files in different project dirs
    const result = await importSessionsByIds({ store, homeDir: tmpHome, sessionIds: [SESSION_A_ID] })
    expect(result.results).toEqual([
      expect.objectContaining({ sessionId: SESSION_A_ID, status: "created", chatId: expect.any(String) }),
    ])
    // sibling B not imported:
    const tokens = [...store.state.chatsById.values()].map((c) => c.sessionTokensByProvider.claude)
    expect(tokens).not.toContain(SESSION_B_ID)
  })
  test("unknown id → not_found; garbage id → invalid_id", async () => {
    const result = await importSessionsByIds({ store, homeDir: tmpHome, sessionIds: ["00000000-0000-4000-8000-000000000000", "garbage"] })
    expect(result.results[0]).toMatchObject({ status: "failed", error: "not_found" })
    expect(result.results[1]).toMatchObject({ status: "failed", error: "invalid_id" })
  })
  test("re-import unchanged → skipped with same chatId", async () => {
    const first = await importSessionsByIds({ store, homeDir: tmpHome, sessionIds: [SESSION_A_ID] })
    const again = await importSessionsByIds({ store, homeDir: tmpHome, sessionIds: [SESSION_A_ID] })
    expect(again.results[0]).toMatchObject({ status: "skipped", chatId: first.results[0].chatId })
  })
  test("grown file → updated and fires onSessionImported with source path", async () => {
    await importSessionsByIds({ store, homeDir: tmpHome, sessionIds: [SESSION_A_ID] })
    appendLineToSessionFile(SESSION_A_PATH) // reuse the growth helper from the bulk "JSONL grows" case
    const seen: SessionImportedInfo[] = []
    const result = await importSessionsByIds({ store, homeDir: tmpHome, sessionIds: [SESSION_A_ID], onSessionImported: (i) => seen.push(i) })
    expect(result.results[0].status).toBe("updated")
    expect(seen[0]).toMatchObject({ sessionId: SESSION_A_ID, sourcePath: SESSION_A_PATH })
  })
})
```

- [ ] **Step 2: Run to verify fail** — importer suite → new block FAILS, old 10 cases PASS.

- [ ] **Step 3: Implement `importSessionsByIds`**

```ts
export async function importSessionsByIds(args: ImportSessionsByIdsArgs): Promise<ImportSessionsByIdsResult> {
  const { store, sessionIds, homeDir = homedir(), onSessionImported } = args
  const results: SingleImportResultRow[] = []
  let newProjects = 0
  for (const raw of sessionIds) {
    const sessionId = extractSessionId(raw)
    if (!sessionId) { results.push({ sessionId: raw, status: "failed", error: "invalid_id" }); continue }
    const filePath = locateClaudeSessionFile(homeDir, sessionId)
    if (!filePath) { results.push({ sessionId, status: "failed", error: "not_found" }); continue }
    const session = parseClaudeSessionFile(filePath)
    if (!session) { results.push({ sessionId, status: "failed", error: "parse_failed" }); continue }
    const outcome = await importOneSession(store, session)
    if (outcome.status === "failed") { results.push({ sessionId, status: "failed", error: outcome.reason }); continue }
    if (outcome.status === "created" && outcome.newProject) newProjects += 1
    const chatId = outcome.chatId
    const title = chatId ? store.state.chatsById.get(chatId)?.title : undefined
    results.push({ sessionId, status: outcome.status, chatId, title })
    if (chatId && onSessionImported) {
      try {
        onSessionImported({ chatId, sessionId, sourcePath: filePath, sourceMtimeMs: statSync(filePath).mtimeMs })
      } catch { /* seam must never fail the import */ }
    }
  }
  return { results, newProjects }
}
```

(`statSync` is already imported in this adapter; `parseClaudeSessionFile` needs importing from `./claude-session-parser.adapter`.)

- [ ] **Step 4: Run to verify pass** — importer suite fully green.

- [ ] **Step 5: Wire protocol + ws-router + client hook** (no new tests; typechecked by lint/build, exercised by PR B/E2E)

`protocol.ts`: add the union member next to `sessions.importClaude`.

`ws-router.ts` (after line 1610, mirroring the bulk case):

```ts
case "sessions.importClaudeSession": {
  const result = await importSessionsByIds({ store, sessionIds: command.sessionIds })
  if (result.newProjects > 0) await refreshDiscovery()
  send(ws, { v: PROTOCOL_VERSION, type: "ack", id, result })
  await broadcastFilteredSnapshots({ includeSidebar: true })
  break
}
```

`useKannaState.ts` (next to `importClaudeSessions`):

```ts
const importClaudeSession = useCallback(async (sessionIds: string[]) => {
  return await socket.command<ImportSessionsByIdsResult>({ type: "sessions.importClaudeSession", sessionIds })
}, [socket])
```

Export it from the hook's return object alongside `importClaudeSessions`. Type-import `ImportSessionsByIdsResult` — move the two result interfaces into `src/shared/protocol.ts` (client may not import from `src/server/**`); the adapter imports them from shared.

- [ ] **Step 6: Full gates + commit + PR**

```bash
bun run test && bun run lint
git add -A && git commit -m "feat(server): import specific Claude sessions by id (sessions.importClaudeSession)"
git push -u origin feat/import-session-by-id
gh pr create --repo cuongtranba/kanna --base main --title "feat: import specific Claude sessions by id (foundation)" \
  --body "$(cat <<'EOF'
Foundation for single-session import (see ~/Downloads/kanna-session-import/SPEC.md).
- importOneSession extracted (bulk behavior unchanged — existing tests unmodified)
- extractSessionId(s) + locateClaudeSessionFile
- sessions.importClaudeSession { sessionIds: string[] } + onSessionImported seam
Walls: importer suites unmodified-green; lint seal green; full suite green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Self-review checklist (run after writing code, before PR)

- [ ] `git diff` on the four existing test files shows ZERO changes except the appended `describe("importSessionsByIds")` block.
- [ ] `sessions.importClaude` handler untouched.
- [ ] Result interfaces live in `src/shared/protocol.ts` (client-importable), adapter re-imports them.
- [ ] `onSessionImported` fires for created AND updated AND skipped-with-chatId (PR C needs re-paste to re-arm the tail — a `skipped` re-paste still carries chatId; verify the implementation calls it whenever `chatId` is set, as written in Step 3).
