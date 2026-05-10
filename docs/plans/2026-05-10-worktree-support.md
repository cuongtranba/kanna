# In-Project Git Worktree Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a Kanna project manage its repository's git worktrees from inside the app — detect existing ones, create new ones, remove them, and pin every chat to exactly one worktree so concurrent chats never collide on a shared working tree.

**Architecture:** Append-only events drive a derived `worktrees: Worktree[]` field on each project. Git is the source of truth; Kanna reconciles on project open and on user-triggered refresh. Each chat carries a `worktreeId` and uses that worktree's path as its agent `cwd`. UI exposes a worktree switcher, a create modal, and a two-step force-remove flow.

**Tech Stack:** Bun + TypeScript server, React + Tailwind client, append-only event store (`src/server/event-store.ts`), `git` subprocess via the existing `runGit` helper in `src/server/diff-store.ts`. Tests use Bun's built-in test runner against ephemeral git repos in temp dirs.

**Reference:** Design doc — `docs/plans/2026-05-10-worktree-support-design.md`.

**Discipline:**
- TDD per task: write failing test → run → implement → run → commit.
- Each task must end with a green `bun test` for the touched files.
- All git subprocesses pass `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0`. Tests use `test(name, fn, 30_000)`.
- No `any` / `unknown` — define real types (per user CLAUDE.md).
- Pre-existing failing tests = stop and ask, do not skip.
- No emojis in code or commit messages unless asked.

**Phasing (one PR per phase):**

| Phase | Scope | PR title prefix |
|-------|-------|-----------------|
| 1 | `worktree-store` git wrapper + tests | `feat(worktrees): server git wrapper` |
| 2 | Events, reducers, migration | `feat(worktrees): event-store integration` |
| 3 | Agent cwd binding | `feat(worktrees): per-chat cwd` |
| 4 | HTTP/WS handlers + read-models | `feat(worktrees): API surface` |
| 5 | Client switcher | `feat(worktrees): switcher UI` |
| 6 | Client create + remove modals | `feat(worktrees): create/remove UI` |
| 7 | Mobile drawer | `feat(worktrees): mobile UI` |
| 8 | End-to-end manual + integration tests | `test(worktrees): integration` |

Land each phase before starting the next. After every phase commit, run the full `bun test` once.

---

## Phase 1 — `worktree-store` git wrapper

### Task 1: Export `runGit` from `diff-store`

**Why:** `worktree-store.ts` needs the same non-interactive git invocation; duplicating leaks process-management bugs.

**Files:**
- Modify: `src/server/diff-store.ts:131`

**Step 1: Change `async function runGit` → `export async function runGit` and `formatGitFailure` → `export function formatGitFailure`.**

**Step 2: Run `bun test src/server/diff-store.test.ts`. Expected: PASS (no behavior change).**

**Step 3: Commit.**

```bash
git add src/server/diff-store.ts
git commit -m "refactor(diff-store): export runGit and formatGitFailure for reuse"
```

---

### Task 2: Define `GitWorktree` shared type

**Files:**
- Modify: `src/shared/types.ts` (append a new exported type)

**Step 1: Add type:**

```ts
export interface GitWorktree {
  path: string                 // absolute
  branch: string               // e.g. "main", "feat/x", "(detached)"
  sha: string                  // HEAD commit sha
  isPrimary: boolean
  isLocked: boolean            // git has flagged this worktree as locked (pruning inhibited)
}
```

**Step 2: Run `bun build` (or `bun tsc --noEmit` if configured). Expected: clean.**

**Step 3: Commit.**

```bash
git add src/shared/types.ts
git commit -m "feat(worktrees): add GitWorktree shared type"
```

---

### Task 3: `parseWorktreeList` (porcelain parser) — failing test

**Files:**
- Create: `src/server/worktree-store.test.ts`
- Create: `src/server/worktree-store.ts` (empty stub for now)

**Step 1: Write the failing test:**

```ts
import { describe, expect, test } from "bun:test"
import { parseWorktreeList } from "./worktree-store"

describe("parseWorktreeList", () => {
  test("parses primary + secondary worktree", () => {
    const input = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/feat-x",
      "HEAD def456",
      "branch refs/heads/feat/x",
      "",
    ].join("\n")

    const result = parseWorktreeList(input)

    expect(result).toEqual([
      { path: "/repo/main", sha: "abc123", branch: "main", isPrimary: true,  isLocked: false },
      { path: "/repo/.worktrees/feat-x", sha: "def456", branch: "feat/x", isPrimary: false, isLocked: false },
    ])
  })

  test("marks detached HEAD", () => {
    const input = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/wip",
      "HEAD def456",
      "detached",
      "",
    ].join("\n")
    expect(parseWorktreeList(input)[1].branch).toBe("(detached)")
  })

  test("flags locked", () => {
    const input = [
      "worktree /repo/main",
      "HEAD abc123",
      "branch refs/heads/main",
      "locked",
      "",
    ].join("\n")
    expect(parseWorktreeList(input)[0].isLocked).toBe(true)
  })
})
```

**Step 2: Run test. Expected: FAIL (`parseWorktreeList is not a function`).**

```bash
bun test src/server/worktree-store.test.ts
```

**Step 3: Implement `parseWorktreeList` in `worktree-store.ts`.**

```ts
import type { GitWorktree } from "../shared/types"

export function parseWorktreeList(porcelain: string): GitWorktree[] {
  const blocks = porcelain.split(/\r?\n\r?\n/u).map((b) => b.trim()).filter(Boolean)
  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/u)
    let path = ""
    let head = ""
    let branch = "(detached)"
    let isLocked = false
    for (const line of lines) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim()
      else if (line.startsWith("HEAD ")) head = line.slice("HEAD ".length).trim()
      else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim()
        branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref
      } else if (line === "detached") branch = "(detached)"
      else if (line === "locked" || line.startsWith("locked ")) isLocked = true
    }
    return { path, sha: head, branch, isPrimary: index === 0, isLocked }
  })
}
```

**Step 4: Run test. Expected: PASS.**

**Step 5: Commit.**

```bash
git add src/server/worktree-store.ts src/server/worktree-store.test.ts src/shared/types.ts
git commit -m "feat(worktrees): parse git worktree list --porcelain"
```

---

### Task 4: `listWorktrees` against a real temp repo — failing test

**Files:**
- Modify: `src/server/worktree-store.test.ts`
- Modify: `src/server/worktree-store.ts`

**Step 1: Add a `makeTempRepo()` helper at top of test file (mirrors patterns in `diff-store.test.ts`):**

```ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`)
  return r.stdout.toString().trim()
}

function makeTempRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "kanna-wt-"))
  git(dir, "init", "-q", "-b", "main")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  git(dir, "commit", "--allow-empty", "-m", "init")
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
```

**Step 2: Add test:**

```ts
import { listWorktrees } from "./worktree-store"

test("listWorktrees returns the primary worktree for a fresh repo", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const result = await listWorktrees(dir)
    expect(result.length).toBe(1)
    expect(result[0].isPrimary).toBe(true)
    expect(result[0].branch).toBe("main")
  } finally {
    cleanup()
  }
}, 30_000)

test("listWorktrees sees a secondary worktree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    git(dir, "worktree", "add", join(dir, ".worktrees", "feat-x"), "-b", "feat/x")
    const result = await listWorktrees(dir)
    expect(result.length).toBe(2)
    const secondary = result.find((w) => !w.isPrimary)
    expect(secondary?.branch).toBe("feat/x")
  } finally {
    cleanup()
  }
}, 30_000)
```

**Step 3: Run. Expected: FAIL (`listWorktrees not exported`).**

**Step 4: Implement:**

```ts
import { runGit, formatGitFailure } from "./diff-store"

export async function listWorktrees(repoRoot: string): Promise<GitWorktree[]> {
  const result = await runGit(["worktree", "list", "--porcelain"], repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailure(result) || "git worktree list failed")
  }
  return parseWorktreeList(result.stdout)
}
```

**Step 5: Run. Expected: PASS.**

**Step 6: Commit.**

```bash
git add src/server/worktree-store.ts src/server/worktree-store.test.ts
git commit -m "feat(worktrees): listWorktrees via git porcelain"
```

---

### Task 5: `addWorktree` — new branch path

**Files:**
- Modify: `src/server/worktree-store.ts`
- Modify: `src/server/worktree-store.test.ts`

**Step 1: Failing test:**

```ts
import { addWorktree } from "./worktree-store"

test("addWorktree creates a new branch worktree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const wt = await addWorktree(dir, {
      kind: "new-branch",
      branch: "feat/y",
      path: join(dir, ".worktrees", "feat-y"),
    })
    expect(wt.branch).toBe("feat/y")
    expect(wt.isPrimary).toBe(false)
    const list = await listWorktrees(dir)
    expect(list.some((w) => w.branch === "feat/y")).toBe(true)
  } finally {
    cleanup()
  }
}, 30_000)
```

**Step 2: Implement (continue inside `worktree-store.ts`):**

```ts
export type AddWorktreeOpts =
  | { kind: "new-branch"; branch: string; path: string; base?: string }
  | { kind: "existing-branch"; branch: string; path: string }

export async function addWorktree(repoRoot: string, opts: AddWorktreeOpts): Promise<GitWorktree> {
  const args = ["worktree", "add"]
  if (opts.kind === "new-branch") {
    args.push("-b", opts.branch, opts.path)
    if (opts.base) args.push(opts.base)
  } else {
    args.push(opts.path, opts.branch)
  }
  const result = await runGit(args, repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailure(result) || "git worktree add failed")
  }
  const list = await listWorktrees(repoRoot)
  const created = list.find((w) => w.path === opts.path)
  if (!created) throw new Error("worktree created but not found in list")
  return created
}
```

**Step 3: Run. Expected: PASS.**

**Step 4: Commit.**

```bash
git add src/server/worktree-store.ts src/server/worktree-store.test.ts
git commit -m "feat(worktrees): addWorktree for new branches"
```

---

### Task 6: `addWorktree` — existing branch path

**Step 1: Failing test:**

```ts
test("addWorktree attaches an existing branch", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    git(dir, "branch", "feat/exists")
    const wt = await addWorktree(dir, {
      kind: "existing-branch",
      branch: "feat/exists",
      path: join(dir, ".worktrees", "feat-exists"),
    })
    expect(wt.branch).toBe("feat/exists")
  } finally {
    cleanup()
  }
}, 30_000)
```

**Step 2: Run. Expected: PASS (existing implementation already supports this).**

**Step 3: Commit.**

```bash
git add src/server/worktree-store.test.ts
git commit -m "test(worktrees): cover existing-branch addWorktree path"
```

---

### Task 7: `addWorktree` — failure surfaces stderr

**Step 1: Failing test:**

```ts
test("addWorktree throws with git stderr on conflict", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    await addWorktree(dir, { kind: "new-branch", branch: "feat/dup", path: join(dir, ".worktrees", "a") })
    await expect(
      addWorktree(dir, { kind: "new-branch", branch: "feat/dup", path: join(dir, ".worktrees", "b") })
    ).rejects.toThrow(/already (used|exists)/)
  } finally {
    cleanup()
  }
}, 30_000)
```

**Step 2: Run. Expected: PASS (already covered by `formatGitFailure`).**

**Step 3: Commit.**

```bash
git add src/server/worktree-store.test.ts
git commit -m "test(worktrees): surface stderr on duplicate branch"
```

---

### Task 8: `isDirty` — clean and dirty

**Step 1: Failing test:**

```ts
import { isDirty } from "./worktree-store"
import { writeFileSync } from "node:fs"

test("isDirty is false on a clean tree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    expect(await isDirty(dir)).toEqual({ dirty: false, fileCount: 0 })
  } finally { cleanup() }
}, 30_000)

test("isDirty counts modified + untracked", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    writeFileSync(join(dir, "a.txt"), "hello")
    writeFileSync(join(dir, "b.txt"), "world")
    const r = await isDirty(dir)
    expect(r.dirty).toBe(true)
    expect(r.fileCount).toBe(2)
  } finally { cleanup() }
}, 30_000)
```

**Step 2: Implement:**

```ts
export async function isDirty(worktreePath: string): Promise<{ dirty: boolean; fileCount: number }> {
  const result = await runGit(["status", "--porcelain", "-z"], worktreePath)
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailure(result) || "git status failed")
  }
  if (result.stdout.length === 0) return { dirty: false, fileCount: 0 }
  const fileCount = result.stdout.split("\0").filter((s) => s.length > 0).length
  return { dirty: fileCount > 0, fileCount }
}
```

**Step 3: Run. Expected: PASS.**

**Step 4: Commit.**

```bash
git add src/server/worktree-store.ts src/server/worktree-store.test.ts
git commit -m "feat(worktrees): isDirty status check"
```

---

### Task 9: `removeWorktree` — clean and force

**Step 1: Failing test:**

```ts
import { removeWorktree } from "./worktree-store"

test("removeWorktree removes a clean worktree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const path = join(dir, ".worktrees", "feat-z")
    await addWorktree(dir, { kind: "new-branch", branch: "feat/z", path })
    await removeWorktree(dir, path, { force: false })
    expect((await listWorktrees(dir)).length).toBe(1)
  } finally { cleanup() }
}, 30_000)

test("removeWorktree refuses dirty without force", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const path = join(dir, ".worktrees", "feat-z")
    await addWorktree(dir, { kind: "new-branch", branch: "feat/z", path })
    writeFileSync(join(path, "x.txt"), "dirty")
    await expect(removeWorktree(dir, path, { force: false })).rejects.toThrow()
  } finally { cleanup() }
}, 30_000)

test("removeWorktree --force clears dirty worktree", async () => {
  const { dir, cleanup } = makeTempRepo()
  try {
    const path = join(dir, ".worktrees", "feat-z")
    await addWorktree(dir, { kind: "new-branch", branch: "feat/z", path })
    writeFileSync(join(path, "x.txt"), "dirty")
    await removeWorktree(dir, path, { force: true })
    expect((await listWorktrees(dir)).length).toBe(1)
  } finally { cleanup() }
}, 30_000)
```

**Step 2: Implement:**

```ts
export async function removeWorktree(repoRoot: string, path: string, opts: { force: boolean }): Promise<void> {
  const args = ["worktree", "remove"]
  if (opts.force) args.push("--force")
  args.push(path)
  const result = await runGit(args, repoRoot)
  if (result.exitCode !== 0) {
    throw new Error(formatGitFailure(result) || "git worktree remove failed")
  }
}
```

**Step 3: Run. Expected: PASS.**

**Step 4: Commit.**

```bash
git add src/server/worktree-store.ts src/server/worktree-store.test.ts
git commit -m "feat(worktrees): removeWorktree with optional force"
```

---

### Task 10: `slugifyBranch` + collision suffix

**Step 1: Failing test:**

```ts
import { slugifyBranchForPath, resolveDefaultWorktreePath } from "./worktree-store"

test("slugifyBranchForPath replaces unsafe chars", () => {
  expect(slugifyBranchForPath("feat/x")).toBe("feat-x")
  expect(slugifyBranchForPath("Feat With Space")).toBe("feat-with-space")
  expect(slugifyBranchForPath("../escape")).toBe("escape")
})

test("resolveDefaultWorktreePath suffixes on collision", () => {
  const existing = new Set(["/r/.worktrees/feat-x"])
  expect(resolveDefaultWorktreePath("/r", ".worktrees", "feat/x", existing)).toBe("/r/.worktrees/feat-x-2")
})
```

**Step 2: Implement:**

```ts
export function slugifyBranchForPath(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/gu, "-")
    .replace(/[\\/]+/gu, "-")
    .replace(/\.+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "")
}

export function resolveDefaultWorktreePath(repoRoot: string, dir: string, branch: string, existing: Set<string>): string {
  const slug = slugifyBranchForPath(branch)
  const base = `${repoRoot}/${dir}/${slug}`
  if (!existing.has(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
}
```

**Step 3: Run. Expected: PASS.**

**Step 4: Commit.**

```bash
git add src/server/worktree-store.ts src/server/worktree-store.test.ts
git commit -m "feat(worktrees): slugify branch and resolve default path"
```

---

### Phase 1 close

**Step 1:** Run `bun test`. Expected: full green.
**Step 2:** Open PR.

```bash
git push -u origin feat/worktree-support
gh pr create --repo cuongtranba/kanna --base main --head feat/worktree-support \
  --title "feat(worktrees): server git wrapper" \
  --body "$(cat <<'EOF'
## Summary
- Adds `src/server/worktree-store.ts` with `listWorktrees`, `addWorktree`, `removeWorktree`, `isDirty`, `parseWorktreeList`, `slugifyBranchForPath`, `resolveDefaultWorktreePath`.
- Exports `runGit` / `formatGitFailure` from `diff-store.ts`.
- Adds `GitWorktree` shared type.

Phase 1 of the worktree support plan: server-side git wrapper only, no events / UI yet. See `docs/plans/2026-05-10-worktree-support-design.md`.

## Test plan
- [ ] `bun test src/server/worktree-store.test.ts`
- [ ] `bun test` (full suite)
EOF
)"
```

After this PR merges, fast-forward `feat/worktree-support` (or rebase) and start Phase 2.

---

## Phase 2 — Events, reducers, migration

### Task 11: Add worktree events to `events.ts`

**Files:**
- Modify: `src/server/events.ts`

**Step 1:** Add to `ProjectEvent` union:

```ts
| {
    v: 3
    type: "worktree_added"
    timestamp: number
    projectId: string
    worktreeId: string
    path: string
    branch: string
    base?: string
    createdViaUi: boolean
  }
| {
    v: 3
    type: "worktree_removed"
    timestamp: number
    projectId: string
    worktreeId: string
    force: boolean
  }
| {
    v: 3
    type: "worktree_marked_orphaned"
    timestamp: number
    projectId: string
    worktreeId: string
  }
| {
    v: 3
    type: "worktree_backfill_v1"
    timestamp: number
    projectId: string
    primaryWorktreeId: string
  }
| {
    v: 3
    type: "project_worktree_dir_set"
    timestamp: number
    projectId: string
    worktreeDir: string
  }
```

**Step 2:** Extend `ChatEvent` `chat_created`:

```ts
| {
    v: 3
    type: "chat_created"
    timestamp: number
    chatId: string
    projectId: string
    title: string
    worktreeId?: string  // optional for backwards compat
  }
```

**Step 3:** Extend `ProjectRecord` and `ChatRecord`:

```ts
export interface WorktreeRecord {
  id: string
  path: string
  branch: string
  isPrimary: boolean
  status: "active" | "orphaned"
  addedAt: number
}

export interface ProjectRecord extends ProjectSummary {
  deletedAt?: number
  worktrees: WorktreeRecord[]   // always present, may be []
  worktreeDir?: string
}

export interface ChatRecord {
  // ... existing
  worktreeId: string | null
}
```

**Step 4:** Run `bun tsc --noEmit`. Expect compile errors at every reducer/snapshot site that constructs `ProjectRecord` or `ChatRecord`. Fix them all to default `worktrees: []` and `worktreeId: null`. (Search: `grep -rn "ProjectRecord\b" src/`.)

**Step 5:** Run `bun test`. Expected: PASS (no behavior change yet — just shape).

**Step 6:** Commit.

```bash
git add src/server/events.ts src/server/event-store.ts src/shared/types.ts
git commit -m "feat(worktrees): event-store types for worktree state"
```

---

### Task 12: Reducer — `worktree_added`

**Files:**
- Modify: `src/server/event-store.ts` (locate the project-event reducer; pattern matches existing `project_opened` handler)
- Modify: `src/server/event-store.test.ts`

**Step 1: Failing test:**

```ts
test("worktree_added appends a worktree to the project", () => {
  const store = makeTestStore()
  store.appendProjectOpened({ projectId: "p1", localPath: "/repo", title: "repo" })
  store.applyEvent({
    v: 3, type: "worktree_added", timestamp: 1, projectId: "p1",
    worktreeId: "w1", path: "/repo", branch: "main", createdViaUi: false,
  })
  expect(store.getProject("p1")?.worktrees).toEqual([
    { id: "w1", path: "/repo", branch: "main", isPrimary: true, status: "active", addedAt: 1 }
  ])
})
```

(Adapt helper names to existing `event-store.test.ts` style.)

**Step 2:** Run. Expected: FAIL.

**Step 3:** Implement reducer in `event-store.ts`. First-added worktree of a project is `isPrimary: true`; subsequent are `false`.

**Step 4:** Run. Expected: PASS.

**Step 5: Commit.**

```bash
git add src/server/event-store.ts src/server/event-store.test.ts
git commit -m "feat(worktrees): reducer for worktree_added"
```

---

### Task 13: Reducer — `worktree_removed` and `worktree_marked_orphaned`

**Step 1: Failing tests:**

```ts
test("worktree_removed deletes from list", () => { /* ... */ })
test("removing primary promotes next worktree to primary", () => { /* ... */ })
test("worktree_marked_orphaned flips status without deleting", () => { /* ... */ })
test("orphaned chat is read-only at the read-model layer", () => { /* covered in read-models.test.ts */ })
```

**Step 2:** Implement. When the primary is removed, the lowest `addedAt` among the remaining becomes primary.

**Step 3:** Run. PASS.

**Step 4: Commit.**

```bash
git commit -am "feat(worktrees): reducers for worktree_removed and orphan"
```

---

### Task 14: Reducer — `chat_created.worktreeId` + fallback

**Step 1: Failing tests:**

```ts
test("chat_created with worktreeId binds the chat", () => { /* ... */ })
test("chat_created without worktreeId binds to primary worktree", () => { /* ... */ })
test("chat_created without worktreeId on a project with no worktrees yields worktreeId null", () => { /* ... */ })
```

**Step 2:** Implement. When `worktreeId` absent, look up `project.worktrees.find((w) => w.isPrimary)?.id ?? null`.

**Step 3:** Run. PASS.

**Step 4: Commit.**

```bash
git commit -am "feat(worktrees): bind chat to worktree on creation"
```

---

### Task 15: Migration — `worktree_backfill_v1`

**Files:**
- Modify: `src/server/event-store.ts` — add a one-shot migration that runs once per project the first time `loadProjects()` finds a project lacking `worktree_backfill_v1` in its event log.
- Modify: `src/server/event-store.test.ts`

**Step 1: Failing test:**

```ts
test("loading a legacy event log emits worktree_backfill_v1 and binds chats to primary", async () => {
  // craft a fixture log with project_opened + chat_created (no worktree events)
  // load it
  // assert: at least one worktree_added event appended, primary = first
  //         worktree_backfill_v1 appended once
  //         chats now have worktreeId pointing at primary
})
```

**Step 2:** Implement in the loader path. Migration:
1. For each project loaded from log without `worktree_backfill_v1`:
   - Call `listWorktrees(project.localPath)` (best-effort; if it fails because path not a repo, skip migration and write a `worktree_backfill_v1` with `primaryWorktreeId: ""` to mark "no-op done").
   - For every returned worktree, append `worktree_added`.
   - Append `worktree_backfill_v1`.
   - For every existing chat in this project that has no `worktreeId`, append a no-op compatibility shim — actually no event is needed; the reducer already falls back to primary. The backfill event is purely a guard.

**Step 3:** Run. PASS.

**Step 4: Commit.**

```bash
git commit -am "feat(worktrees): one-shot backfill migration on load"
```

---

### Task 16: Reducer — `project_worktree_dir_set`

**Step 1: Failing test:**

```ts
test("project_worktree_dir_set updates the directory", () => { /* ... */ })
```

**Step 2:** Implement (one-line reducer).

**Step 3:** Commit.

```bash
git commit -am "feat(worktrees): reducer for worktreeDir setting"
```

---

### Phase 2 close

`bun test` must be fully green. Open PR `feat(worktrees): event-store integration`.

---

## Phase 3 — Agent cwd binding

### Task 17: Resolve worktree path for `ClaudeSessionState`

**Files:**
- Modify: `src/server/agent.ts:97-109`
- Modify: `src/server/agent.test.ts` (or add a new `agent.worktree.test.ts`)

**Step 1: Failing test:**

```ts
test("agent cwd resolves to the chat's bound worktree path", async () => {
  // arrange a project with two worktrees, a chat bound to the secondary
  // dispatch a turn-start
  // assert: startClaudeSession called with localPath = secondary worktree path
})

test("agent refuses to start a turn when the chat's worktree is orphaned", async () => {
  // arrange chat bound to a worktree that is then orphaned
  // dispatch turn-start
  // assert: turn_failed event with error matching /worktree.*removed/
})
```

**Step 2:** Implement in `agent.ts`. Add a helper `resolveChatCwd(state, chat): { ok: true; path: string } | { ok: false; reason: "orphaned" | "no-worktree" }` and use it at every place currently reading `project.localPath` for the chat's cwd.

**Step 3:** Run. PASS.

**Step 4:** Commit.

```bash
git commit -am "feat(worktrees): per-chat cwd from worktree binding"
```

---

### Task 18: Diff/commit/push surfaces use the chat's worktree

**Files:**
- Modify: `src/server/diff-store.ts` — every public method takes a path; pass the chat's worktree path from the call site.
- Modify: `src/server/ws-router.ts` (or whichever HTTP/WS handler dispatches diff/commit) to look up the chat's worktree.

**Step 1:** Failing test that drives a chat's diff against a feature-branch worktree.
**Step 2:** Implement.
**Step 3:** Commit.

```bash
git commit -am "feat(worktrees): diff/commit/push routed through chat worktree"
```

---

### Phase 3 close

PR `feat(worktrees): per-chat cwd`.

---

## Phase 4 — API surface

### Task 19: WS messages

**Files:**
- Modify: `src/shared/types.ts` — add request/response shapes:

```ts
export type WorktreeRequest =
  | { type: "worktree.list"; projectId: string }
  | { type: "worktree.refresh"; projectId: string }
  | { type: "worktree.add"; projectId: string; opts: AddWorktreeRequestOpts }
  | { type: "worktree.remove"; projectId: string; worktreeId: string; force: boolean }
  | { type: "worktree.set_dir"; projectId: string; dir: string }

export type AddWorktreeRequestOpts =
  | { kind: "new-branch"; branch: string; base?: string; pathOverride?: string }
  | { kind: "existing-branch"; branch: string; pathOverride?: string }
```

**Step 2:** Wire into `ws-router.ts` with an `await` on `worktreeService.X(...)`. Reuse error formatter.

**Step 3:** Add tests in `src/server/ws-router.test.ts` (or matching test file).

**Step 4:** Commit per message type.

---

### Task 20: Read-model shape for client

**Files:**
- Modify: `src/server/read-models.ts` — `ProjectSummary` gains `worktrees: WorktreeSummary[]` and `worktreeDir`.
- Modify: `src/shared/types.ts` — add `WorktreeSummary`.

```ts
export interface WorktreeSummary {
  id: string
  path: string
  branch: string
  isPrimary: boolean
  status: "active" | "orphaned"
}
```

Tests: `src/server/read-models.test.ts` covers shape.

Commit.

---

### Task 21: List local + remote branches for the create modal

**Files:**
- Modify: `src/server/worktree-store.ts` — `listBranches(repoRoot): Promise<{ local: string[]; remote: string[] }>`.

```ts
export async function listBranches(repoRoot: string): Promise<{ local: string[]; remote: string[] }> {
  const r = await runGit(["for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/"], repoRoot)
  if (r.exitCode !== 0) throw new Error(formatGitFailure(r) || "git for-each-ref failed")
  const lines = r.stdout.split(/\r?\n/u).map((s) => s.trim()).filter(Boolean)
  const local = lines.filter((l) => l.startsWith("refs/heads/")).map((l) => l.slice("refs/heads/".length))
  const remote = lines
    .filter((l) => l.startsWith("refs/remotes/") && !l.endsWith("/HEAD"))
    .map((l) => l.slice("refs/remotes/".length))
  return { local, remote }
}
```

Test it. Wire to a `worktree.list_branches` WS message. Commit.

---

### Phase 4 close

PR `feat(worktrees): API surface`.

---

## Phase 5 — Client switcher

Reference: existing patterns in `src/client/components/` and the kanna-react-style skill (apply on every TSX edit).

### Task 22: Worktree switcher component (read-only)

**Files:**
- Create: `src/client/components/WorktreeSwitcher.tsx`
- Create: `src/client/components/WorktreeSwitcher.test.tsx`

Show dropdown with all active worktrees + orphaned ones (red label). Selection lives in URL state (`?worktree=<id>`) so refresh persists. Default = primary.

**Step 1:** Failing snapshot/render test with mocked project.
**Step 2:** Implement.
**Step 3:** Commit.

---

### Task 23: Filter chat list by selected worktree

Modify `src/client/app/...` chat-list view to read the active worktree id and filter `chats.filter((c) => c.worktreeId === activeWorktreeId)`.

Tests + commit.

---

### Task 24: Chat header `branch:` badge

Add a small inline badge next to the chat title showing the worktree's branch.

Tests + commit.

---

### Phase 5 close — PR `feat(worktrees): switcher UI`.

---

## Phase 6 — Create + remove modals

### Task 25: Create modal — new vs existing branch

- New `src/client/components/CreateWorktreeModal.tsx`.
- Form: radio (new-branch / existing-branch), branch name (or picker), base (default = repo default branch), path override (default = computed).
- Call `worktree.add` WS. On error, surface stderr in modal (no toast — keep the form open).

Tests + commit.

---

### Task 26: Two-step force remove

- New `src/client/components/RemoveWorktreeModal.tsx`.
- First click → `worktree.remove({force:false})`. If server returns dirty error → show second dialog with checkbox "I understand", button enables only when checked, on confirm send `force:true`.
- Block remove entirely if any chat in this worktree is currently running (read from existing chat-state stream).

Tests + commit.

---

### Phase 6 close — PR.

---

## Phase 7 — Mobile drawer

### Task 27: Drawer entry above chat list

- Modify the existing mobile chat-list drawer (look at `src/client/components/Sidebar*`).
- Add a worktree switcher row that opens a sheet listing all worktrees.

Tests on touch interaction (use existing mobile test harness).

Commit. PR.

---

## Phase 8 — Integration + manual verification

### Task 28: End-to-end integration test

- Drive a real temp repo through the WS layer: open project → assert worktree detected → create worktree → assert chat-list bind → remove dirty → assert two-step force flow → orphan via shell `git worktree remove` → assert reconcile flips status.

### Task 29: Manual verification checklist

Run `bun run dev`, exercise:

- [ ] Open existing project → worktree switcher appears, main pre-selected.
- [ ] Switch worktree → chat list filters; create chat → cwd is the worktree path (verify via a `pwd`-running shell tool call).
- [ ] Create new-branch worktree → appears in switcher.
- [ ] Create existing-branch worktree.
- [ ] Remove clean worktree.
- [ ] Try remove dirty → blocked → second dialog → force → succeeds.
- [ ] Shell-create a worktree, click refresh → appears.
- [ ] Shell-remove a worktree → next refresh marks it orphaned, chats become read-only.
- [ ] Mobile: drawer entry works, modals render full-screen.
- [ ] Pre-existing project (legacy log) loads correctly (migration ran once).

If any item fails, file a follow-up task and stop. Do not declare phase complete until all items pass.

### Task 30: Final PR + release notes

PR `test(worktrees): end-to-end integration`. After merge, update `CHANGELOG`/release notes for the next version bump.

---

## Notes for implementers

- **Pre-existing failures:** if `bun test` is not green on `main` before you start, stop and ask the user. Do not try to fix unrelated issues silently.
- **Skill triggers:** any `.tsx` edit in Phase 5–7 → invoke the `kanna-react-style` skill. Any test edit → consider `test-quality-verify`. Before claiming a task done → run `superpowers:verification-before-completion`.
- **Subprocess discipline:** every git spawn passes `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0`. Tests use `test(name, fn, 30_000)`.
- **No `any`:** define real types. The `GitWorktree`, `WorktreeRecord`, `WorktreeSummary`, and `AddWorktreeOpts` types in this plan are the canonical shapes — share them via `src/shared/types.ts`.
- **DRY:** if you find yourself parsing porcelain output again, extend `parseWorktreeList` instead.
- **YAGNI:** detached HEAD, branch rename, cross-worktree diff, auto-repair are all explicitly deferred. Do not add them.

When in doubt about UI placement, read existing components in `src/client/components/` and match their patterns. When in doubt about the event store, read `src/server/event-store.ts` end-to-end before adding a reducer.
