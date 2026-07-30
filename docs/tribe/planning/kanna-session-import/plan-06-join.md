# PR F — Join: E2E + Docs Sweep + C3 Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the whole single-session-import + live-tail feature end-to-end against a
Tribe-shaped fixture (main JSONL + a `subagents/` sidecar dir, exactly what a real campaign
session leaves on disk), then close out the project's docs: CLAUDE.md env-var section, wiki
env-var table regen, and the `c3 change apply` for the ADR opened in plan-01 Task 1.

**Architecture:** No new production code — this card is pure verification + documentation. It
depends on PR A (foundation), PR B (ui/dialog), and PR C (live tail) all being merged to `main`,
since the E2E drives the real `importSessionsByIds` → `FollowedSessionRegistry` → event-store
path through the same seams those PRs introduce.

**Divergence from INDEX.md's original note:** INDEX.md's "Join task" section originally said
"not a separate plan — append to whichever of B/C merges last." This campaign runs one PR per
card, so the join task is promoted to its own card/branch/PR (`dependsOn: [ui, live]`) instead of
being folded into another PR's diff. Logged in INDEX.md's Decision log (see update alongside this
file). This is a How-level packaging change, not a scope/wall change — the work described in
INDEX.md is unchanged.

**Tech Stack:** Bun + TypeScript, Kanna EventStore + `bun test --conditions production`; docs
edits to `CLAUDE.md` and `wiki/`; C3 CLI for the ADR apply.

## Global Constraints

- Repo: `/Users/home/repos/kanna`, branch off `main` (must be at or after PR A+B+C's merge
  commits — verify with `git log --oneline -- src/server/followed-session-registry.ts
  src/client/components/ImportSessionsDialog.tsx` before starting; if either is absent, STOP,
  this card is not yet progressable).
- WALL: existing suites in `src/server/claude-session-{importer,scanner,parser,mapper}.test.ts`
  stay unmodified.
- WALL: `bun run lint` green (`--max-warnings=0`); new IO only in `*.adapter.ts`.
- WALL: `bun run test` (`--conditions production`) green before every push.
- Commits: no agent co-author lines. PR targets `cuongtranba/kanna` via
  `gh pr create --repo cuongtranba/kanna`.
- Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.
- Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).

---

### Task 1: E2E fixture builder (pure helper, no IO in the helper itself)

**Files:**
- Create: `src/server/__fixtures__/tribe-session-fixture.ts` (exempt glob per CLAUDE.md's
  Side-Effect Lint section: `src/server/__fixtures__/**`)
- Test: none (this is a test-fixture builder; it is exercised by Task 2's test)

**Interfaces:**
- Produces: `writeTribeSessionFixture(dir: string, opts: { sessionId: string; cwd: string }): {
  mainJsonlPath: string; subagentsDir: string; appendLine: (line: object) => void }` — writes a
  main transcript JSONL (a `system/init`, one `user` turn, one `assistant` turn with a `tool_use`
  Agent/Task call carrying an `agentId`) plus a sibling `<sessionId>/subagents/agent-<id>.jsonl`
  with two lines (mirrors the shape plan-04's spike Task 1 checks for). `appendLine` lets the test
  grow the main file after the initial import to exercise the live-tail delta path.

- [x] **Step 1: Write the fixture module.**

```ts
// src/server/__fixtures__/tribe-session-fixture.ts
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"

export interface TribeSessionFixture {
  mainJsonlPath: string
  subagentsDir: string
  appendLine: (line: object) => void
}

export function writeTribeSessionFixture(
  dir: string,
  opts: { sessionId: string; cwd: string },
): TribeSessionFixture {
  const { sessionId, cwd } = opts
  mkdirSync(dir, { recursive: true })
  const mainJsonlPath = join(dir, `${sessionId}.jsonl`)
  const agentId = "hunter-1"
  const initLine = { type: "system", subtype: "init", cwd, session_id: sessionId }
  const userLine = { type: "user", message: { role: "user", content: "ship card foundation" } }
  const assistantLine = {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: "Agent", input: { agentId, description: "hunter task 1" } },
      ],
    },
  }
  writeFileSync(
    mainJsonlPath,
    [initLine, userLine, assistantLine].map((l) => JSON.stringify(l)).join("\n") + "\n",
  )

  const subagentsDir = join(dir, sessionId, "subagents")
  mkdirSync(subagentsDir, { recursive: true })
  const agentFile = join(subagentsDir, `agent-${agentId}.jsonl`)
  writeFileSync(
    agentFile,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "task 1 brief" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "done" }] } }),
    ].join("\n") + "\n",
  )

  return {
    mainJsonlPath,
    subagentsDir,
    appendLine: (line: object) => appendFileSync(mainJsonlPath, JSON.stringify(line) + "\n"),
  }
}
```

- [x] **Step 2: Commit** — `git commit -m "test(server): Tribe-shaped session fixture builder for E2E"`
  (no failing-test step: this is a fixture-only helper with no independent behavior to assert;
  Task 2 is its first real exercise and proves it works).

### Task 2: E2E — import by UUID, assert chat + entries, grow file, tick, assert delta

**Files:**
- Create: `src/server/session-import-e2e.test.ts`
- Test: itself

**Interfaces:**
- Consumes: `importSessionsByIds` (plan-01 Task 5), `createFollowedSessionRegistry` (plan-03
  Task 1), `statSessionFile` (plan-03 Task 2), `writeTribeSessionFixture` (Task 1), the same
  `EventStore` test-construction helper the four importer/scanner/parser/mapper suites already
  use (grep `createTestStore` or equivalent in `src/server/claude-session-importer.test.ts` and
  reuse it verbatim — do not hand-roll a second store fixture).

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { importSessionsByIds } from "./claude-session-importer.adapter"
import { createFollowedSessionRegistry } from "./followed-session-registry"
import { statSessionFile } from "./followed-session-io.adapter"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"
import { importOneSession } from "./claude-session-importer.adapter"
import { writeTribeSessionFixture } from "./__fixtures__/tribe-session-fixture"
// import the same store-construction helper claude-session-importer.test.ts uses:
import { createTestStore } from "./claude-session-importer.test" // adjust to the file's actual exported helper name

const SESSION_ID = "9f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"

describe("session import E2E (Tribe-shaped fixture)", () => {
  test("import by uuid creates a chat with entries, then a live-tail tick appends the delta", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "kanna-e2e-"))
    const projectsRoot = join(tmpHome, ".claude", "projects", "-Users-home-repos-tribe-target")
    const fixture = writeTribeSessionFixture(projectsRoot, {
      sessionId: SESSION_ID,
      cwd: "/Users/home/repos/tribe-target",
    })

    const store = createTestStore()
    const seen: { chatId: string; sessionId: string; sourcePath: string; sourceMtimeMs: number }[] = []
    const result = await importSessionsByIds({
      store,
      homeDir: tmpHome,
      sessionIds: [SESSION_ID],
      onSessionImported: (info) => seen.push(info),
    })

    expect(result.results[0]).toMatchObject({ sessionId: SESSION_ID, status: "created" })
    const chatId = result.results[0].chatId!
    const before = store.getMessages(chatId)
    expect(before.length).toBeGreaterThan(0)
    expect(seen[0]).toMatchObject({ chatId, sessionId: SESSION_ID, sourcePath: fixture.mainJsonlPath })

    const registry = createFollowedSessionRegistry({
      statFile: statSessionFile,
      runDelta: async (cid, sourcePath) => {
        const session = parseClaudeSessionFile(sourcePath)
        if (session) await importOneSession(store, session)
      },
      isTurnActive: () => false,
      now: () => Date.now(),
      onChange: () => {},
      activeWindowMs: 600_000,
      idleMs: 600_000,
    })
    registry.consider(seen[0])

    fixture.appendLine({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "turn 2" }] },
    })
    await registry.tick()

    const after = store.getMessages(chatId)
    expect(after.length).toBeGreaterThan(before.length)
  })
})
```

- [x] **Step 2: Run to verify fail** — `bun test --conditions production
  src/server/session-import-e2e.test.ts` → FAIL on whatever the actual store-helper import name
  turns out to be (adjust the import to match `claude-session-importer.test.ts`'s real exported
  helper — confirm its name first with `grep -n "^export function createTestStore\|^function
  createTestStore" src/server/claude-session-importer.test.ts`; if the file doesn't export one,
  inline the same store-construction lines that file's `beforeEach` uses).

- [x] **Step 3: Fix imports/wiring until green.** No production code changes are expected here —
  this task exercises already-shipped PR A/C surface. If a real gap surfaces (e.g. a store
  helper isn't exported for reuse), the minimal fix is exporting it from the existing test file,
  never duplicating store-construction logic.

- [x] **Step 4: Run to verify pass.**

- [x] **Step 5: Commit** — `git commit -m "test(server): E2E — import by uuid + live-tail delta against Tribe-shaped fixture"`

### Task 3: Docs sweep — CLAUDE.md env vars + wiki table regen

**Files:**
- Modify: `CLAUDE.md` (env-var reference sections — follow the existing "Env vars" subsection
  style used by the PTY driver section)
- Regenerate: `wiki/` env-var table

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a `KANNA_IMPORT_FOLLOW_*` env-var subsection to `CLAUDE.md`**, next to the
  other feature sections, documenting (names/defaults from plan-03's Global Constraints):
  - `KANNA_IMPORT_FOLLOW_POLL_MS` — stat-poll tick interval for the live-tail registry. Default `2000`.
  - `KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS` — a single-session import auto-arms tailing only when
    the source file's mtime is within this window. Default `600000`.
  - `KANNA_IMPORT_FOLLOW_IDLE_MS` — stop following after this long with no growth. Default `600000`.

- [ ] **Step 2: Regenerate the wiki env-var table**

```bash
cd wiki && bun run scripts/extract-env-vars.ts
```

- [ ] **Step 3: Commit** — `git commit -m "docs: KANNA_IMPORT_FOLLOW_* env vars (CLAUDE.md + wiki table)"`

### Task 4: `c3 change apply` for the foundation ADR + `c3 check`

**Files:**
- Apply the change-unit opened in plan-01 Task 1: `.c3/changes/adr-20260730-import-single-claude-session/`
- Modify: whatever `.c3/` docs that change-unit's patches touch (c3-214 corrections, new
  codemap bindings for the importer/scanner/parser/mapper adapters — see plan-01 Task 1 Step 3)

**Interfaces:** none (C3 doc maintenance only).

- [ ] **Step 1: Confirm the change-unit exists and is unapplied**

```bash
c3() { C3X_MODE=agent bash /Users/home/.claude/plugins/cache/c3-skill-marketplace/c3-skill/11.0.0/skills/c3/bin/c3x.sh "$@"; }
c3 change list adr-20260730-import-single-claude-session
```

If the change-unit from plan-01 Task 1 does not exist (foundation card diverged), STOP and
escalate `NEEDS_DIRECTION` — do not author a fresh ADR here; this task only applies the one PR A
already opened.

- [ ] **Step 2: Apply and validate**

```bash
c3 change apply adr-20260730-import-single-claude-session
c3 check
```

- [ ] **Step 3: Commit** — `git commit -m "docs(c3): apply adr-20260730-import-single-claude-session change-unit"`

### Task 5: Gates + PR

- [ ] **Step 1:** `bun run test && bun run lint`
- [ ] **Step 2:** `git diff --stat` on the four wall-protected test files — must be empty.
- [ ] **Step 3: Commit + push + PR**

```bash
git push -u cuongtranba HEAD
gh pr create --repo cuongtranba/kanna --base main \
  --title "test+docs: E2E for single-session import/live-tail, env-var docs, c3 apply" \
  --body "$(cat <<'EOF'
Join task for the single-session-import + live-Tribe-visualization project (see
docs/tribe/planning/kanna-session-import/SPEC.md). Depends on PR A (foundation), PR B (ui),
PR C (live) already merged.

- E2E: import a Tribe-shaped session (main JSONL + subagents/ sidecar) by uuid, assert the
  resulting chat has entries; grow the source file, tick the FollowedSessionRegistry, assert
  the delta appended.
- Docs: KANNA_IMPORT_FOLLOW_* env vars in CLAUDE.md + wiki table regen.
- c3 change apply adr-20260730-import-single-claude-session + c3 check.

Walls: importer/scanner/parser/mapper suites unmodified; lint seal green; full suite green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Self-review checklist

- [ ] E2E fixture lives under the exempt `src/server/__fixtures__/**` glob (no lint violation).
- [ ] E2E never touches the four wall-protected test files.
- [ ] Live-tail delta in the E2E goes through `FollowedSessionRegistry.tick()` — never a direct
      HarnessEvent/turn-pipeline call (c3-225).
- [ ] `c3 check` clean after the apply.
