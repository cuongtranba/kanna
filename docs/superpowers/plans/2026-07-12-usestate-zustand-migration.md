# useState → Zustand Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all in-scope `useState` usage in `src/client/` (277 call sites / 60 files) by moving state into Zustand stores, enforced by an ast-grep rule that CI hard-gates at zero violations.

**Architecture:** Tasks 1–6 build the tooling foundation (ast-grep rule + tests, ratchet script, baseline report, `createScopedStore` helper, PROGRESS.md task list, CI gate) on the `zustand-migration` branch. Task 7 arms Kanna's `setup_loop`; background subagents then execute the ~16 module migrations listed in PROGRESS.md. Task 8 lands everything as ONE PR.

**Tech Stack:** Bun, TypeScript (TS7 typecheck), React 19, zustand ^5.0.10, @ast-grep/cli, ESLint 10 (react-hooks v7).

**Spec:** `docs/superpowers/specs/2026-07-12-usestate-zustand-migration-design.md`

## Global Constraints

- ALL work happens in the worktree `.worktrees/zustand-migration` on branch `zustand-migration`. Never commit to `main`. Single PR at the end, target `cuongtranba/kanna` main.
- Frozen allowlist (never extend without explicit user approval): `src/client/**/*.test.ts`, `src/client/**/*.test.tsx`, `src/client/components/ui/**`, `src/client/hooks/useIsMobile.ts`, `src/client/hooks/useNow.ts`, `src/client/hooks/useStickyState.ts`, `src/client/hooks/useTheme.tsx`, `src/client/hooks/useIsStandalone.ts`.
- Tests: `bun test --conditions production <file>` for targeted runs; full suite is `bun run test`. Never bare `bun test` (Lexical TDZ crash).
- Typecheck is `bun run typecheck` (TS7 via explicit path). Never bare `tsc`/`bunx tsc`.
- Lint: `bun run lint` (`--max-warnings=0`). No new warnings — react-hooks v7 warnings count against the cap. No `eslint-disable` comments.
- Strong typing: no `any`; type all store state/action interfaces.
- Side-effect seal: `src/client/**` may not import node/Bun IO primitives. `scripts/**` is NOT linted/sealed — the ratchet script may use `Bun.spawnSync`.
- Render-loop rule: every selector returning a collection uses a stable `EMPTY` constant or `useShallow`. Never inline `?? []` / `?? {}` in a selector.
- Before editing any component, run `c3x lookup <file>` for component context.
- No behavior change: migrations relocate state only. Existing tests are the oracle.

---

### Task 1: ast-grep rule + rule tests

**Files:**
- Modify: `package.json` (devDependency + scripts)
- Create: `sgconfig.yml`
- Create: `rules/no-react-usestate.yml`
- Create: `rules/no-react-usestate-ts.yml`
- Create: `rules/__tests__/no-react-usestate-test.yml`
- Create: `rules/__tests__/no-react-usestate-ts-test.yml`

**Interfaces:**
- Produces: rule ids `no-react-usestate` (tsx) and `no-react-usestate-ts` (ts) — the ratchet script (Task 2) filters scan matches on the prefix `no-react-usestate`. Script `lint:usestate` = `ast-grep scan --report-style short` (exits non-zero on any match because severity is `error`).

- [ ] **Step 1: Install @ast-grep/cli pinned**

```bash
cd /home/cuong/repo/kanna/.worktrees/zustand-migration
bun add --dev --exact @ast-grep/cli
```

Expected: `package.json` devDependencies gains `"@ast-grep/cli": "<exact version>"`; `node_modules/.bin/ast-grep --version` prints that version.

- [ ] **Step 2: Create `sgconfig.yml`**

```yaml
ruleDirs:
  - rules
testConfigs:
  - testDir: rules/__tests__
```

- [ ] **Step 3: Create `rules/no-react-usestate.yml`**

ast-grep scopes rules per language; `.tsx` and `.ts` are distinct languages, so two rule files share the same body. Generic-call patterns are REQUIRED — `useState($$$)` alone misses `useState<T>(...)` (~half the codebase's sites).

```yaml
id: no-react-usestate
language: tsx
severity: error
message: useState is banned for application state — move state and actions into a Zustand store.
note: |
  Singleton feature state -> src/client/stores/<feature>Store.ts (zustand create()).
  Per-instance component state -> colocated <Component>.store.ts using
  createScopedStore from src/client/lib/createScopedStore.tsx.
  Spec: docs/superpowers/specs/2026-07-12-usestate-zustand-migration-design.md
files:
  - src/client/**
ignores:
  - src/client/**/*.test.ts
  - src/client/**/*.test.tsx
  - src/client/components/ui/**
  - src/client/hooks/useIsMobile.ts
  - src/client/hooks/useNow.ts
  - src/client/hooks/useStickyState.ts
  - src/client/hooks/useTheme.tsx
  - src/client/hooks/useIsStandalone.ts
rule:
  any:
    - pattern: useState($$$ARGS)
    - pattern: useState<$$$T>($$$ARGS)
    - pattern: React.useState($$$ARGS)
    - pattern: React.useState<$$$T>($$$ARGS)
    - all:
        - kind: import_specifier
          regex: ^useState\b
        - inside:
            stopBy: end
            kind: import_statement
            has:
              field: source
              regex: ^['"]react['"]$
```

- [ ] **Step 4: Create `rules/no-react-usestate-ts.yml`**

Identical body, `id: no-react-usestate-ts`, `language: typescript`. Copy the file and change only those two lines.

- [ ] **Step 5: Write rule tests (failing first — run before snapshots exist)**

`rules/__tests__/no-react-usestate-test.yml`:

```yaml
id: no-react-usestate
valid:
  - const value = useAppStore((state) => state.value)
  - import { useEffect, useMemo } from "react"
  - const [a, b] = usePair(0)
invalid:
  - const [count, setCount] = useState(0)
  - const [tab, setTab] = useState<Tab>("new")
  - const [x, setX] = React.useState(0)
  - const [y, setY] = React.useState<number | null>(null)
  - import { useState } from "react"
  - import { useEffect, useState as useLocalState } from "react"
```

`rules/__tests__/no-react-usestate-ts-test.yml`: same content with `id: no-react-usestate-ts`.

- [ ] **Step 6: Run rule tests, generate snapshots, verify pass**

```bash
node_modules/.bin/ast-grep test --update-all
node_modules/.bin/ast-grep test
```

Expected: all test cases pass (valid = no match, invalid = matched). Commit generated `rules/__tests__/__snapshots__/`.

- [ ] **Step 7: Add package script and sanity-scan**

In `package.json` scripts add:

```json
"lint:usestate": "ast-grep scan --report-style short"
```

Run `bun run lint:usestate`. Expected: hundreds of violations listed, exit code non-zero (severity `error`). Spot-check that NO reported path is in the allowlist (no `ui/`, no `*.test.*`, none of the five exempt hooks).

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock sgconfig.yml rules/
git commit -m "feat(lint): add ast-grep no-react-usestate rule with frozen allowlist"
```

---

### Task 2: Ratchet script (loop-internal tooling)

**Files:**
- Create: `scripts/usestate-ratchet-lib.ts`
- Create: `scripts/usestate-ratchet-lib.test.ts`
- Create: `scripts/usestate-ratchet.ts`
- Create: `usestate-baseline.json` (generated by `--update`)
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: rule id prefix `no-react-usestate` from Task 1.
- Produces: CLI `bun scripts/usestate-ratchet.ts` with modes: default (fail if count > baseline), `--zero` (fail unless count === 0), `--update` (rewrite `usestate-baseline.json`), `--markdown` (print per-file report table). `usestate-baseline.json` shape: `{ "count": number }`. Pure lib exports used by tests: `countByFile`, `evaluateRatchet`, `renderMarkdownReport`.

- [ ] **Step 1: Write failing tests** — `scripts/usestate-ratchet-lib.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { countByFile, evaluateRatchet, renderMarkdownReport } from "./usestate-ratchet-lib"

describe("countByFile", () => {
  test("aggregates match files into counts", () => {
    expect(countByFile(["a.tsx", "b.tsx", "a.tsx"])).toEqual({ "a.tsx": 2, "b.tsx": 1 })
  })
  test("empty input produces empty record", () => {
    expect(countByFile([])).toEqual({})
  })
})

describe("evaluateRatchet", () => {
  test("ratchet mode passes at or below baseline", () => {
    expect(evaluateRatchet(10, 10, "ratchet").ok).toBe(true)
    expect(evaluateRatchet(9, 10, "ratchet").ok).toBe(true)
  })
  test("ratchet mode fails above baseline", () => {
    const result = evaluateRatchet(11, 10, "ratchet")
    expect(result.ok).toBe(false)
    expect(result.message).toContain("11")
    expect(result.message).toContain("10")
  })
  test("zero mode fails on any violation", () => {
    expect(evaluateRatchet(1, 10, "zero").ok).toBe(false)
    expect(evaluateRatchet(0, 10, "zero").ok).toBe(true)
  })
})

describe("renderMarkdownReport", () => {
  test("renders sorted table with total", () => {
    const md = renderMarkdownReport({ "b.tsx": 1, "a.tsx": 3 }, "2026-07-12")
    expect(md).toContain("| a.tsx | 3 |")
    expect(md.indexOf("a.tsx")).toBeLessThan(md.indexOf("b.tsx"))
    expect(md).toContain("Total: 4")
  })
})
```

- [ ] **Step 2: Run tests, verify FAIL**

```bash
bun test --conditions production scripts/usestate-ratchet-lib.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/usestate-ratchet-lib.ts`**

```ts
export type RatchetMode = "ratchet" | "zero"

export interface RatchetEvaluation {
  ok: boolean
  total: number
  baseline: number
  message: string
}

export function countByFile(matchFiles: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of matchFiles) {
    counts[file] = (counts[file] ?? 0) + 1
  }
  return counts
}

export function evaluateRatchet(total: number, baseline: number, mode: RatchetMode): RatchetEvaluation {
  if (mode === "zero") {
    return {
      ok: total === 0,
      total,
      baseline,
      message: total === 0
        ? "useState violations: 0 — goal met."
        : `useState violations: ${total} — goal is 0.`,
    }
  }
  return {
    ok: total <= baseline,
    total,
    baseline,
    message: total <= baseline
      ? `useState violations: ${total} (baseline ${baseline}) — OK.`
      : `useState violations: ${total} exceed baseline ${baseline} — new useState introduced. Remove it or migrate it to Zustand.`,
  }
}

export function renderMarkdownReport(byFile: Record<string, number>, generatedAt: string): string {
  const rows = Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b))
  const total = rows.reduce((sum, [, count]) => sum + count, 0)
  const lines = [
    `# useState violation report (${generatedAt})`,
    "",
    `Total: ${total} violations across ${rows.length} files.`,
    "",
    "| File | Violations |",
    "| --- | --- |",
    ...rows.map(([file, count]) => `| ${file} | ${count} |`),
    "",
  ]
  return lines.join("\n")
}
```

- [ ] **Step 4: Run tests, verify PASS**

```bash
bun test --conditions production scripts/usestate-ratchet-lib.test.ts
```

Expected: all pass.

- [ ] **Step 5: Implement CLI `scripts/usestate-ratchet.ts`**

```ts
import { countByFile, evaluateRatchet, type RatchetMode } from "./usestate-ratchet-lib"

interface AstGrepScanMatch {
  file: string
  ruleId: string
}

const BASELINE_PATH = new URL("../usestate-baseline.json", import.meta.url).pathname

function scanMatches(): AstGrepScanMatch[] {
  const proc = Bun.spawnSync(
    ["node_modules/.bin/ast-grep", "scan", "--json", "src/client"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const raw = proc.stdout.toString().trim()
  if (!raw) return []
  const parsed = JSON.parse(raw) as AstGrepScanMatch[]
  return parsed.filter((match) => match.ruleId.startsWith("no-react-usestate"))
}

async function readBaseline(): Promise<number> {
  const file = Bun.file(BASELINE_PATH)
  if (!(await file.exists())) {
    console.error(`Missing ${BASELINE_PATH} — run with --update to create it.`)
    process.exit(2)
  }
  const parsed = (await file.json()) as { count: number }
  return parsed.count
}

const matches = scanMatches()
const byFile = countByFile(matches.map((match) => match.file))
const total = matches.length

if (process.argv.includes("--update")) {
  await Bun.write(BASELINE_PATH, `${JSON.stringify({ count: total }, null, 2)}\n`)
  console.log(`Baseline updated: ${total} violations.`)
  process.exit(0)
}

if (process.argv.includes("--markdown")) {
  const { renderMarkdownReport } = await import("./usestate-ratchet-lib")
  console.log(renderMarkdownReport(byFile, new Date().toISOString().slice(0, 10)))
  process.exit(0)
}

const mode: RatchetMode = process.argv.includes("--zero") ? "zero" : "ratchet"
const baseline = mode === "zero" ? 0 : await readBaseline()
const result = evaluateRatchet(total, baseline, mode)

const sorted = Object.entries(byFile).sort(([, a], [, b]) => b - a)
for (const [file, count] of sorted) console.log(`${String(count).padStart(4)}  ${file}`)
console.log(result.message)
process.exit(result.ok ? 0 : 1)
```

- [ ] **Step 6: Generate baseline and verify modes**

```bash
bun scripts/usestate-ratchet.ts --update
bun scripts/usestate-ratchet.ts
bun scripts/usestate-ratchet.ts --zero; echo "exit=$?"
```

Expected: `--update` writes `usestate-baseline.json` (count will exceed 277 — the import-specifier rule adds ~1 match per importing file; the exact number printed is the authoritative baseline). Default mode passes; `--zero` prints the per-file table and exits 1.

- [ ] **Step 7: Add package scripts**

In `package.json` scripts add:

```json
"migrate:count": "bun scripts/usestate-ratchet.ts",
"migrate:verify": "bun scripts/usestate-ratchet.ts --zero && bun run check && bun run test"
```

- [ ] **Step 8: Commit**

```bash
git add scripts/usestate-ratchet.ts scripts/usestate-ratchet-lib.ts scripts/usestate-ratchet-lib.test.ts usestate-baseline.json package.json
git commit -m "feat(tooling): useState ratchet script with zero/update/markdown modes"
```

---

### Task 3: Baseline report document

**Files:**
- Create: `docs/superpowers/specs/usestate-baseline-report.md`

**Interfaces:**
- Consumes: `bun scripts/usestate-ratchet.ts --markdown` (Task 2).
- Produces: the committed migration-start snapshot referenced by the spec's Definition of Done.

- [ ] **Step 1: Generate the per-file table**

```bash
bun scripts/usestate-ratchet.ts --markdown > docs/superpowers/specs/usestate-baseline-report.md
```

- [ ] **Step 2: Append the module/effort section**

Append to the generated file:

```markdown
## Violations by module (call sites, allowlist excluded)

| Module | Call sites | Files | Effort |
| --- | --- | --- | --- |
| Settings (SettingsPage + sections + OAuthTokenPoolCard) | 84 | 6 | L |
| Chat UI shell (RightSidebar, navbar, cards, dialogs, NewProjectModal) | 48 | 8 | L |
| App state hub (useKannaState) | 30 | 1 | L |
| Sidebar (KannaSidebar + stack rows/panels + Menus) | 22 | 4 | M |
| Messages cards batch B (system/plan/question/user/account/image/preview/download/link) | 21 | 10 | M |
| Messages cards batch A (subagent/mermaid/thinking/code/shared) | 17 | 6 | M |
| ChatPage (index, viewport, sidebar actions, terminal toggle) | 13 | 4 | M |
| File preview (sheet, viewport fetch, bodies) | 10 | 5 | M |
| Workflows (page, section, transcript panel) | 9 | 3 | S |
| Composer (ChatInput, mention suggestions, lexical plugins) | 9 | 5 | M |
| App shell (App, KannaTranscript, SharePage, LocalDev, open-external-menu) | 8 | 5 | S |
| Terminal (workspace, pane) | 5 | 2 | S |
| Share (SharePopover) | 1 | 1 | S |
| **Total** | **277** | **60** | ~16 loop iterations |

Estimated effort: one loop iteration (background subagent run) per PROGRESS.md
task; L modules may take multiple iterations. Expected wall-clock: 2–4 days of
unattended loop execution including test runs.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/usestate-baseline-report.md
git commit -m "docs: useState migration baseline report"
```

---

### Task 4: createScopedStore helper

**Files:**
- Create: `src/client/lib/createScopedStore.tsx`
- Create: `src/client/lib/createScopedStore.test.tsx`

**Interfaces:**
- Consumes: `zustand` (`createStore`, `useStore`, `StoreApi`, `StateCreator`), React context.
- Produces (used by every multi-instance migration task in PROGRESS.md):

```ts
function createScopedStore<TProps, TState>(
  displayName: string,
  createState: (init: TProps) => StateCreator<TState>
): {
  Provider: (props: { init: TProps; children: ReactNode }) => ReactNode
  useScopedStore: <TSelected>(selector: (state: TState) => TSelected) => TSelected
  useScopedStoreApi: () => StoreApi<TState>
}
```

- [ ] **Step 1: Write failing tests** — `src/client/lib/createScopedStore.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import type { StoreApi } from "zustand"
import { renderForLoopCheck } from "./testing/renderForLoopCheck"
import { createScopedStore } from "./createScopedStore"

interface CounterState {
  count: number
  increment: () => void
}

const Counter = createScopedStore<{ start: number }, CounterState>(
  "CounterStore",
  (init) => (set) => ({
    count: init.start,
    increment: () => set((state) => ({ count: state.count + 1 })),
  })
)

function CaptureApi({ onApi }: { onApi: (api: StoreApi<CounterState>) => void }) {
  const api = Counter.useScopedStoreApi()
  useEffect(() => {
    onApi(api)
  }, [api, onApi])
  return null
}

function ShowCount() {
  const count = Counter.useScopedStore((state) => state.count)
  return <span data-testid="count">{count}</span>
}

describe("createScopedStore", () => {
  test("each Provider instance gets an isolated store", async () => {
    const apis: StoreApi<CounterState>[] = []
    const result = await renderForLoopCheck(
      <>
        <Counter.Provider init={{ start: 1 }}>
          <CaptureApi onApi={(api) => apis.push(api)} />
        </Counter.Provider>
        <Counter.Provider init={{ start: 100 }}>
          <CaptureApi onApi={(api) => apis.push(api)} />
        </Counter.Provider>
      </>
    )
    expect(result.thrown).toBeNull()
    expect(apis).toHaveLength(2)
    apis[0]!.getState().increment()
    expect(apis[0]!.getState().count).toBe(2)
    expect(apis[1]!.getState().count).toBe(100)
    await result.cleanup()
  })

  test("useScopedStore outside Provider throws a named error", async () => {
    const result = await renderForLoopCheck(<ShowCount />)
    expect(String(result.thrown)).toContain("CounterStore")
    expect(String(result.thrown)).toContain("Provider")
    await result.cleanup()
  })

  test("selector subscription does not trigger render loops", async () => {
    const result = await renderForLoopCheck(
      <Counter.Provider init={{ start: 0 }}>
        <ShowCount />
      </Counter.Provider>
    )
    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
    await result.cleanup()
  })
})
```

- [ ] **Step 2: Run tests, verify FAIL**

```bash
bun test --conditions production src/client/lib/createScopedStore.test.tsx
```

Expected: FAIL — `createScopedStore` module not found.

- [ ] **Step 3: Implement `src/client/lib/createScopedStore.tsx`**

```tsx
import { createContext, useContext, useRef, type ReactNode } from "react"
import { createStore, useStore, type StateCreator, type StoreApi } from "zustand"

export interface ScopedStore<TProps, TState> {
  Provider: (props: { init: TProps; children: ReactNode }) => ReactNode
  useScopedStore: <TSelected>(selector: (state: TState) => TSelected) => TSelected
  useScopedStoreApi: () => StoreApi<TState>
}

export function createScopedStore<TProps, TState>(
  displayName: string,
  createState: (init: TProps) => StateCreator<TState>
): ScopedStore<TProps, TState> {
  const Context = createContext<StoreApi<TState> | null>(null)

  function Provider({ init, children }: { init: TProps; children: ReactNode }) {
    const storeRef = useRef<StoreApi<TState> | null>(null)
    if (storeRef.current === null) {
      storeRef.current = createStore<TState>(createState(init))
    }
    return <Context.Provider value={storeRef.current}>{children}</Context.Provider>
  }

  function useScopedStoreApi(): StoreApi<TState> {
    const store = useContext(Context)
    if (store === null) {
      throw new Error(`${displayName}: useScopedStore must be used inside its Provider`)
    }
    return store
  }

  function useScopedStore<TSelected>(selector: (state: TState) => TSelected): TSelected {
    return useStore(useScopedStoreApi(), selector)
  }

  return { Provider, useScopedStore, useScopedStoreApi }
}
```

Note: the guarded lazy `useRef` init is the React-docs-blessed pattern for expensive ref contents. If `bun run lint` flags it under `react-hooks/refs`, switch the Provider body to `const store = useMemo(() => createStore<TState>(createState(init)), [])` — but do NOT add an eslint-disable.

- [ ] **Step 4: Run tests, verify PASS**

```bash
bun test --conditions production src/client/lib/createScopedStore.test.tsx
```

Expected: 3 pass.

- [ ] **Step 5: Targeted lint + typecheck**

```bash
bunx eslint src/client/lib/createScopedStore.tsx src/client/lib/createScopedStore.test.tsx --max-warnings=0
bun run typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/lib/createScopedStore.tsx src/client/lib/createScopedStore.test.tsx
git commit -m "feat(client): createScopedStore helper for per-instance zustand stores"
```

---

### Task 5: PROGRESS.md migration task list

**Files:**
- Create: `PROGRESS.md` (worktree root)

**Interfaces:**
- Consumes: `createScopedStore` (Task 4), ratchet script (Task 2).
- Produces: the loop's tracking file. Its "Next chunk" section is the per-iteration subagent brief.

- [ ] **Step 1: Create `PROGRESS.md` with exactly this content**

````markdown
# useState → Zustand Migration Progress

## Goal
`bun run migrate:verify` exits 0 in `.worktrees/zustand-migration`
(zero useState violations + check + full test suite green).

## Worker rules (every subagent MUST follow)
- Work ONLY in `/home/cuong/repo/kanna/.worktrees/zustand-migration` (branch `zustand-migration`). Commit there.
- Before editing a file: `c3x lookup <file>` for component context.
- Singleton feature state → store in `src/client/stores/<feature>Store.ts` (follow `rightSidebarStore.ts` conventions: typed interface, actions in store, `persist` only when the old state was persisted).
- Per-instance component state (component rendered N times) → colocated `<Component>.store.ts` using `createScopedStore` from `src/client/lib/createScopedStore.tsx`; wrap the component subtree in its `Provider`.
- Derived data via selectors; collections use a module-level `EMPTY` constant or `useShallow` — NEVER inline `?? []` / `?? {}` in a selector (React error #185).
- No behavior change. No new features. No `any`. No `eslint-disable`.
- Acceptance per task:
  1. `bun scripts/usestate-ratchet.ts` passes AND total strictly decreased; run `bun scripts/usestate-ratchet.ts --update` after verifying.
  2. Zero ast-grep hits remain in the task's files (check the per-file table).
  3. `bun test --conditions production <touched test files and colocated tests>` passes.
  4. `bunx eslint <touched files> --max-warnings=0` passes.
  5. `bun run typecheck` passes.
  6. Commit with message `refactor(zustand): migrate <module> off useState`, update this file (mark task done, set Next chunk), then terminate.

## Tasks (priority order; call-site counts at baseline)
- [ ] T1 App state hub: `src/client/app/useKannaState.ts` (30)
- [ ] T2 ChatPage: `src/client/app/ChatPage/index.tsx` (8), `ChatTranscriptViewport.tsx` (2), `useChatPageSidebarActions.ts` (2), `src/client/app/useTerminalToggleAnimation.ts` (1)
- [ ] T3 Composer: `src/client/components/chat-ui/ChatInput.tsx` (5), `src/client/hooks/useMentionSuggestions.ts` (1), `src/client/components/lexical/plugins/SlashCommandTypeaheadPlugin.tsx` (1), `MentionTypeaheadPlugin.tsx` (1), `src/client/components/lexical/markdown/MessageCodeBlock.tsx` (1)
- [ ] T4 Sidebar: `src/client/app/KannaSidebar.tsx` (15), `src/client/components/chat-ui/sidebar/Menus.tsx` (1), `StackChatCreateRow.tsx` (4), `StackCreatePanel.tsx` (2)
- [ ] T5 RightSidebar: `src/client/components/chat-ui/RightSidebar.tsx` (31)
- [ ] T6 Chat-UI misc: `ChatNavbar.tsx` (1), `AutoContinueCard.tsx` (2), `TranscriptActionCard.tsx` (2), `ChatPreferenceControls.tsx` (3), `ChatPolicyDialog.tsx` (5), `PtyInstancesIndicator.tsx` (1), `src/client/components/NewProjectModal.tsx` (3)
- [ ] T7 App shell: `src/client/app/App.tsx` (4), `KannaTranscript.tsx` (1), `share-view/SharePage.tsx` (1), `src/client/components/LocalDev.tsx` (1), `open-external-menu.tsx` (1)
- [ ] T8 Terminal: `src/client/components/chat-ui/TerminalWorkspace.tsx` (3), `TerminalPane.tsx` (2)
- [ ] T9 Messages A (multi-instance — use createScopedStore): `SubagentTaskMessage.tsx` (5), `MermaidDiagram.tsx` (4), `MermaidZoomModal.tsx` (3), `ThinkingBlock.tsx` (1), `HighlightedCode.tsx` (1), `shared.tsx` (3) — all under `src/client/components/messages/`
- [ ] T10 Messages B (multi-instance): `SystemMessage.tsx` (3), `ExitPlanModeMessage.tsx` (4), `AskUserQuestionInteractive.tsx` (3), `AskUserQuestionMessage.tsx` (2), `UserMessage.tsx` (1), `AccountInfoMessage.tsx` (1), `ImageGenerationMessage.tsx` (1), `PreviewFileMessage.tsx` (2), `OfferDownloadMessage.tsx` (2), `LocalFileLinkCard.tsx` (2)
- [ ] T11 File preview: `src/client/components/messages/file-preview/FilePreviewSheet.tsx` (1), `useViewportFetch.ts` (4), `bodies/textLoader.ts` (2), `bodies/TableBody.tsx` (2), `bodies/CodeBody.tsx` (1)
- [ ] T12 SettingsPage: `src/client/app/SettingsPage.tsx` (42)
- [ ] T13 McpServersSection: `src/client/app/McpServersSection.tsx` (18)
- [ ] T14 Settings sections: `ModelsSection.tsx` (7), `SubagentsSection.tsx` (7), `TextSnippetsSection.tsx` (5), `src/client/components/chat-ui/OAuthTokenPoolCard.tsx` (5)
- [ ] T15 Workflows: `src/client/app/WorkflowsPage.tsx` (3), `WorkflowsSection.tsx` (2), `WorkflowAgentTranscriptPanel.tsx` (4)
- [ ] T16 Final sweep: `src/client/components/share/SharePopover.tsx` (1) + any file still listed by `bun scripts/usestate-ratchet.ts --zero`; then run `bun run migrate:verify` and fix everything until it exits 0

## Progress (latest first)
- 2026-07-12 Tooling landed (rule, ratchet, baseline report, createScopedStore). Loop not yet started.

## Failed approaches
- (none yet)

## Next chunk
T1 App state hub: migrate `src/client/app/useKannaState.ts` (30 call sites) off useState into zustand store(s) in `src/client/stores/`. Follow ALL Worker rules above, satisfy all 6 acceptance criteria, update this file, then terminate.
````

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: migration PROGRESS.md task list for setup_loop"
```

---

### Task 6: CI hard gate

**Files:**
- Modify: `.github/workflows/test.yml:24` (after the lint step)

**Interfaces:**
- Consumes: `lint:usestate` script (Task 1).
- Produces: CI step that fails on ANY useState violation. This makes the mega PR unmergeable until the migration is complete — intended (strictly-one-PR strategy).

- [ ] **Step 1: Add the gate step**

After the `- run: bun run lint` step insert:

```yaml
      - name: useState gate (ast-grep)
        run: bun run lint:usestate
```

- [ ] **Step 2: Verify workflow syntax locally**

```bash
bunx yaml-lint .github/workflows/test.yml 2>/dev/null || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/test.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: hard-gate useState violations via ast-grep scan"
```

---

### Task 7: Arm the migration loop

**Files:** none (operational).

**Interfaces:**
- Consumes: `PROGRESS.md` (Task 5), `migrate:verify` (Task 2), a configured Kanna coding subagent.

- [ ] **Step 1: Pre-flight**

```bash
git status          # clean tree on zustand-migration
bun run migrate:count   # passes (at baseline)
bun run test        # full suite green before the loop starts
```

- [ ] **Step 2: Ensure a coding subagent exists**

`setup_loop` delegates each chunk to a Kanna subagent. If Settings → Subagents has no general-purpose coding subagent, ask the user (AskUserQuestion) to create one (provider claude, no `maxTurns`, description "general coding worker") or to designate the default loop subagent in Settings.

- [ ] **Step 3: Arm the loop**

Call `mcp__kanna__setup_loop` with EXACTLY:

- `goal`: `useState migration complete: migrate:verify exits 0`
- `verify_command`: `cd .worktrees/zustand-migration && bun run migrate:verify`
- `tracking_file`: `.worktrees/zustand-migration/PROGRESS.md`
- `subagent_id`: the coding subagent's id (omit if a default loop subagent is configured)

The loop then runs unattended: each iteration a background subagent executes the Next chunk from PROGRESS.md, and the main agent re-checks verify. On verify exit 0 the model prints GOAL MET, calls `stop_loop`, and ends the turn.

---

### Task 8: Landing (after GOAL MET)

**Files:**
- Delete: `scripts/usestate-ratchet.ts`, `scripts/usestate-ratchet-lib.ts`, `scripts/usestate-ratchet-lib.test.ts`, `usestate-baseline.json`
- Modify: `package.json` (remove `migrate:count` + `migrate:verify`; KEEP `lint:usestate`)
- Move: `PROGRESS.md` → `docs/superpowers/specs/usestate-migration-progress.md`

**Interfaces:**
- Consumes: completed migration (loop stopped, `stop_loop` called).
- Produces: the single mega PR.

- [ ] **Step 1: Delete ratchet tooling (side-effect-seal endgame pattern)**

```bash
git rm scripts/usestate-ratchet.ts scripts/usestate-ratchet-lib.ts scripts/usestate-ratchet-lib.test.ts usestate-baseline.json
git mv PROGRESS.md docs/superpowers/specs/usestate-migration-progress.md
```

Edit `package.json`: remove the `migrate:count` and `migrate:verify` script entries. `lint:usestate` and the CI step remain — they are the permanent regression gate.

- [ ] **Step 2: Full verification (verification-before-completion — read every output)**

```bash
bun run lint:usestate   # zero violations, exit 0
bun run lint            # zero errors/warnings over cap
bun run typecheck       # clean
bun run test            # full suite green
bun run build           # clean
```

- [ ] **Step 3: UI smoke test in browser**

Start `bun run dev` and verify golden paths with the agent-browser skill or manually: send/receive a chat message, sidebar navigation + collapse, right sidebar changes/history views, settings CRUD (models, MCP servers, snippets), message cards render (thinking block expand, mermaid diagram, question card), file preview sheet. Watch the console for React #185 / getSnapshot warnings — any occurrence is a blocker.

- [ ] **Step 4: C3 sweep**

Run `/c3 sweep` — new files (`src/client/lib/createScopedStore.tsx`, new stores, `rules/`) may need component-doc updates in `.c3/` in the same PR.

- [ ] **Step 5: Commit landing changes**

```bash
git add -A
git commit -m "chore(migration): drop ratchet tooling, keep permanent useState gate"
```

- [ ] **Step 6: Open the single PR**

```bash
git push -u origin zustand-migration
gh pr create --repo cuongtranba/kanna --base main --head zustand-migration \
  --title "refactor(client): migrate all application state from useState to Zustand" \
  --body "$(cat <<'EOF'
## Summary
- ast-grep rule `no-react-usestate` (+ frozen allowlist) hard-gated in CI
- 277 useState call sites across 60 files migrated to Zustand (feature stores + createScopedStore per-instance factories)
- Baseline report + migration progress log in docs/superpowers/specs/

## Test plan
- [ ] `bun run lint:usestate` — zero violations
- [ ] `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build` green
- [ ] UI smoke: chat flow, sidebars, settings CRUD, message cards, file preview
EOF
)"
```

---

## Self-review notes

- Spec coverage: rule+allowlist (T1), ratchet+report (T2–T3), scoped-store helper (T4), task generation+priority (T5), loop execution (T7), CI gate (T6), landing/DoD (T8). Module migration content itself is intentionally owned by PROGRESS.md per the approved design.
- Type consistency: `createScopedStore(displayName, createState)` signature identical in Task 4 code, its tests, and PROGRESS.md worker rules. Ratchet lib exports match between test and implementation.
- Baseline number: `usestate-baseline.json` is generated, never hand-written; report/PROGRESS counts are call-site counts (import-specifier matches excluded from those tables but included in the ratchet total — consistent because the ratchet only compares against its own generated number).
