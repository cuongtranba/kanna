# Decomposition Review & Browser Verification

## Goal

Review commit `174140b5` (LOC-budget restore) against its plan, bind the new file into `.c3/`, and produce honest evidence — screenshots where a browser can legitimately reach the code, passing tests where it cannot.

**Non-goal: no behavior change.** The only production edits this task adds are two c3 binding lines, one stray-blank-line cleanup, and one genuinely missing unit test.

## Verify command

```
bun run typecheck && bun run lint && bun run check:arch && bun test --conditions production src/server/event-store*.test.ts src/server/ws-router*.test.ts
```

Deliberately **not** `scripts/verify-decomp.sh` — that runs the full suite, and the `src/server/claude-pty/` tests are timing-flaky (they spawn the real `claude` binary with `hardCapMs: 10`), so it cannot exit 0 on this machine.

## Progress (latest first)

- 2026-08-29 Phase 3 DONE: 17 screenshots captured. project.create x2, stack.create, stack.rename, stack.remove, project.setStar, project.remove all browser-exercised. Replay-survival confirmed: star icon visible after kill+restart against same tmpHome (1 starred icon, 2 project sections survived). Screenshots at e2e/screenshots/review-PHASE3-*.png (untracked). Replay proves commit()→JSONL-append→boot-replay pipeline through the free functions in event-store-stacks.ts works end-to-end.

- 2026-08-29 Phase 2 DONE: event-store.stack-methods 30/0, ws-router.stack 9/0, ws-router-misc 22/0, ws-router-observability 12/0 (10 orig + 2 new backgroundTasks.getOutput), import-subagent-drill 1/0. Full suite 7285/2skip/1fail — 1 fail is env-only pty binary missing in branch node_modules (same code as baseline confirmed by git diff). Phase 2 complete; see Evidence index.

- 2026-08-29 Phase 1 DONE (commit `807179c7`): bound `event-store-stacks.ts` into `.c3/eval/c3-206.yaml` + `.c3/code-map.yaml`; `c3x repair` ran, reverted unintended `structural.md` churn, kept only the two intended edits; `c3x lookup` resolves to c3-206; `c3x check` exit 0, exactly 1 warning (pre-existing c3-113); method-by-method diff of all 10 moved methods against baseline `366cbcf8` confirms behavior-preserving (all 4 nullable builders keep `if (event) await commit(event)`, param order matches every call site, no `this`-binding lost); removed the stray blank line in event-store.ts constructor; `bun run typecheck` / `bun run lint` / `bun run check:arch` all exit 0.

- 2026-08-29 Phase 0 DONE. Branch `review/decomp-loc-restore` created off `366cbcf8`; refactor committed as `174140b5` (7 files). Tracking doc written. Next: Phase 1.

## Failed approaches

- (none yet)

## Next chunk

Phase 4 — consolidation. See ## Phase plan.

## Ground truth (measured 2026-08-29 — do NOT re-derive)

| Fact | Evidence |
|---|---|
| Baseline SHA is `366cbcf8` | `main` tip, pre-refactor. Refactor is `174140b5` on `review/decomp-loc-restore`. |
| `dist/` does not exist | `ls dist` → No such file or directory. Phase 3 **must** `bun run build` first; `bootKanna()` throws without `dist/client`. |
| `c3x check` exits 0 today | `Checked 231 docs — 1 warning`, exit 0. The warning is **pre-existing** (`c3-113`, stale anchor on `KannaTranscript.store.ts`) and unrelated to this diff. |
| The c3 gap is real but not gate-blocking | `c3x check` only warns on stale anchors, never on new unlisted files. `c3x lookup src/server/event-store-stacks.ts` → no component mapping. |
| `c3-206` owns the event-store family | `.c3/eval/c3-206.yaml` `code:` already lists `event-store.ts`, `event-store-write-ops.ts`, `event-store-messages.adapter.ts`. |
| `deps-bundles` is pinned at exactly `max: 80` | `src/ops/architecture/budget.ts:90`. Zero headroom. The free-function shape in `event-store-stacks.ts` was **forced** — do not "improve" it into a `*Deps` interface. |
| The refactor left a stray blank line | `git show 174140b5 -- src/server/event-store.ts`, hunk `@@ -244,6 +237,7 @@`. Unintended; Phase 1 removes it. |
| The user's real Kanna is LIVE on port 3210 | Global install `~/.bun/bin/kanna`, serving a public Cloudflare tunnel. Harness port 3299 is free. Never touch 3210. |
| Pre-existing failures are in `src/server/claude-pty/` | `tui-control.test.ts`, `driver.test.ts`. Untouched by this diff. **Exact count is UNCONFIRMED** — Phase 2 step 4 must measure it against baseline. |
| `lint:usestate` is recoverable | ast-grep's local binary is missing, but `sgconfig.yml` exists and `bunx @ast-grep/cli scan` fetches it. |

### Coverage reality — where a screenshot would LIE

**7 of 10 touched paths are browser-reachable; 3 are not.**

| Path | Browser? | Honest evidence |
|---|---|---|
| `project.open` / `create` / `remove` / `setStar` | Yes | Screenshots (Phase 3) |
| `stack.create` / `rename` / `remove` | Yes | Screenshots (Phase 3) |
| `backgroundTasks.getOutput` | **NO** — no client sends it. The UI reaches that registry via the `background-task-output` *subscribe* topic (`ws-router-envelope.ts:400-415`), a different path. A green panel proves the wrong thing. | New unit test (Phase 2) — this branch has **zero** coverage today |
| `stack.addProject` / `removeProject` | **NO** — `handleAddProjectToStack` / `handleRemoveProjectFromStack` (`useAppGlobalState.ts:1206,1215`) are never passed to any component | `event-store.stack-methods.test.ts` (exists, 13 KB) |
| `stack.remove` durability | Partial — a vanished row proves React state, not that the soft-delete committed | Restart against the same temp `HOME`; confirm it survives replay |

## Evidence index

| Claim | Artifact | Command that produced it |
|---|---|---|
| _(populated by each phase)_ | | |
- claim: c3-206 owns event-store-stacks.ts | artifact: `.c3/eval/c3-206.yaml`, `.c3/code-map.yaml` (commit `807179c7`) | command: `bash "$HOME/.claude/skills/c3/bin/c3x.sh" lookup src/server/event-store-stacks.ts` → matches c3-206
- claim: c3x repair caused no collateral doc damage | artifact: `git status --short .c3/` post-repair showed only `structural.md` churn (reverted) plus the 2 intended files | command: `git checkout -- .c3/_index/structural.md`
- claim: c3x check unaffected (still exactly 1 pre-existing warning) | artifact: stdout pasted in this turn | command: `bash "$HOME/.claude/skills/c3/bin/c3x.sh" check` → exit 0, 1 warning (c3-113)
- claim: all 10 moved methods are behavior-preserving vs baseline `366cbcf8` | artifact: `/tmp/event-store-baseline.ts` (git show 366cbcf8:src/server/event-store.ts) diffed by hand against `src/server/event-store-stacks.ts` + the 10 delegating one-liners in `src/server/event-store.ts:295-304` | command: manual read, no automated diff tool used
- claim: stray blank line removed | artifact: `src/server/event-store.ts` constructor, commit `807179c7` | command: `git show 174140b5 -- src/server/event-store.ts` (identified hunk) then Edit
- claim: typecheck/lint/check:arch all green post-change | artifact: stdout pasted in this turn | command: `bun run typecheck && bun run lint && bun run check:arch` (run separately, each exit 0)
- claim: event-store.stack-methods replay-determinism passes (30 tests) | artifact: stdout "30 pass 0 fail" | command: `bun test --conditions production src/server/event-store.stack-methods.test.ts`
- claim: ws-router.stack, ws-router-misc, ws-router-observability, import-subagent-drill all pass | artifact: 9/0, 22/0, 12/0, 1/0 | command: each `bun test --conditions production src/server/<file>.test.ts`
- claim: backgroundTasks.getOutput now has 2 new unit tests (snapshot envelope + undefined-registry fallback) | artifact: `src/server/ws-router-observability.test.ts` (committed), 12 pass up from 10 | command: `bun test --conditions production src/server/ws-router-observability.test.ts`
- claim: pty 1-fail is environment-only (missing binary in branch node_modules, not a code regression) | artifact: baseline=298/0, branch=297/1; `git diff 366cbcf8..HEAD -- src/server/claude-pty/` returns empty; baseline node_modules has 247 MB binary, branch does not | command: `git diff 366cbcf8..HEAD -- src/server/claude-pty/ 2>&1 | wc -c` = 0
- claim: full suite 7285/2skip/1fail, sole failure is the env-only pty test | artifact: stdout pasted | command: `bun test --conditions production 2>&1 | tail -5`
- claim: Phase 3 build succeeds (dist/ present) | artifact: `dist/client/` (16.59s build) | command: `bun run build` exit 0
- claim: project.create browser-exercised x2 | artifact: `e2e/screenshots/review-PHASE3-01-project1-created.png`, `review-PHASE3-02-project2-created.png` (untracked) | command: Playwright: click "Add Project" → fill "Project name" → click "Create"; WebSocket `project.create` dispatched by `event-store-stacks.ts:createProject`
- claim: stack.create browser-exercised | artifact: `e2e/screenshots/review-PHASE3-05-stack-created.png` (untracked) | command: Playwright: click "New stack" → fill `aria-label="Stack name"` → select 2 project chips → click "Save"; WebSocket `stack.create` dispatched by `event-store-stacks.ts:createStack`
- claim: stack.rename browser-exercised | artifact: `e2e/screenshots/review-PHASE3-08-stack-renamed.png` (untracked) | command: Playwright: click "Stack actions" → click "Rename" → fill new name → "Save"; WebSocket `stack.rename` dispatched by `event-store-stacks.ts:renameStack`
- claim: stack.remove browser-exercised | artifact: `e2e/screenshots/review-PHASE3-10-stack-deleted.png` (untracked) | command: Playwright: click "Stack actions" → click "Delete MyRenamedStack"; WebSocket `stack.remove` dispatched by `event-store-stacks.ts:removeStack`
- claim: project.setStar browser-exercised | artifact: `e2e/screenshots/review-PHASE3-12-project-starred.png` (untracked) | command: Playwright: `evaluate(el.click())` on `aria-label="Project options"` → click "Star project" from context menu; WebSocket `project.setStar` dispatched by `event-store-stacks.ts:setProjectStar`
- claim: project.remove browser-exercised | artifact: `e2e/screenshots/review-PHASE3-14-project-hidden.png` (untracked) | command: Playwright: `evaluate(el.click())` on `aria-label="Project options"` → click "Hide" from context menu; WebSocket `project.remove` dispatched by `event-store-stacks.ts:removeProject`
- claim: REPLAY SURVIVAL — star state persists after kill+restart against same tmpHome | artifact: `e2e/screenshots/review-PHASE3-16-replay-survival.png` (untracked); `Starred icons visible after replay: 1` (console output) | command: Playwright: bootServer(tmpHome) → star project → server.kill() → bootServer(same tmpHome) → count `[aria-label="Starred"]` = 1; proves commit()→JSONL→replay pipeline through free functions in event-store-stacks.ts

## Phase plan (do NOT skip ahead)

### Phase 1 — c3 binding + static correctness
1. Add `- src/server/event-store-stacks.ts` to `code:` in `.c3/eval/c3-206.yaml` **and** to the `c3-206:` block in `.c3/code-map.yaml`. Production file only — do NOT add test files (scope creep).
2. `c3x repair`, then **immediately** `git status --short .c3/` and `git checkout --` every hunk outside those two files.
3. `c3x lookup src/server/event-store-stacks.ts` must resolve to `c3-206`.
4. `c3x check` must stay exit 0 with **exactly one** warning (`c3-113`). A second warning was caused by this phase.
5. Re-derive behavior preservation: for each of the 10 moved methods, diff the pre-refactor body (`git show 366cbcf8:src/server/event-store.ts`) against `event-store-stacks.ts` — especially the `if (event) await commit(event)` null-guard on the four nullable builders.
6. Remove the stray blank line in `event-store.ts`.
7. `bun run typecheck && bun run lint && bun run check:arch`.

### Phase 2 — non-browser behavioral proof
1. Run `src/server/event-store.stack-methods.test.ts` — contains a **replay-determinism** test, the strongest single proof that threading `commit` through free functions did not break event sourcing.
2. Run `ws-router.stack.test.ts`, `ws-router-misc.test.ts`, `ws-router-observability.test.ts`, `import-subagent-drill.e2e.test.ts`.
3. Add a `backgroundTasks.getOutput` case to `ws-router-observability.test.ts` with a stub registry, asserting the `snapshot` envelope shape including the `content: ""` / `truncated: false` fallback.
4. `git worktree add /tmp/kanna-baseline 366cbcf8`; run ONLY `bun test --conditions production src/server/claude-pty/` there; compare counts to the branch. Test-only — never boot the app from that worktree.
5. Run the full suite once; record exact failing test names; correct Ground truth if the count differs.

### Phase 3 — build, boot, browser evidence
1. `bun run build` (required — `dist/` is absent).
2. Boot via **`bootKanna()` itself**, never a hand-rolled spawn. `e2e/boot.ts:219` sets `KANNA_DISABLE_SELF_UPDATE: "1"`; omitting it on a fresh temp `HOME` lets the CLI self-update the user's **global** install underneath the live tunnel-serving process.
3. Navigate to `http://localhost:3299` **twice** (first visit redirects to `/settings/changelog`); gate on `[data-sidebar="open"]`.
4. Create **two** projects (`aria-label="New stack"` is disabled below 2). Then `stack.create` → `rename` → `remove` via `aria-label="Stack actions"`; then `project.setStar` and `project.remove` via the sidebar row menu.
5. **Replay-survival check:** kill the server, re-boot against the *same* temp `HOME`, screenshot that surviving state matches.
6. Screenshots to `e2e/screenshots/review-*.png`. Leave **untracked**; reference absolute paths from the Evidence index.
7. Cleanup: kill the process group, then `rm -rf ${TMPDIR}/kanna-e2e-home-*`.

### Phase 4 — consolidation
1. Re-run `bun run typecheck && bun run lint && bun run check:arch`; `wc -l` the 5 budget files (expect 588 / 46 / 583 / 479 / 481).
2. Recover the missed gate: `bunx @ast-grep/cli scan --report-style short`.
3. Final summary as a three-column table: **gate · result · what it does not prove**.
4. Set `## Next chunk` to `none — task complete`.

## Worker rules (every subagent MUST follow)

- Read this file with `mcp__kanna__query_tracking_file` (`file: "PROGRESS-decomp-review.md"`), section-scoped. Never read it whole except for the terminal check.
- Update it with `mcp__kanna__append_tracking_row` (Progress, Failed approaches) and `mcp__kanna__replace_tracking_section` (Next chunk). **Always pass `file: "PROGRESS-decomp-review.md"`** — the default is `PROGRESS.md`, which belongs to a different, completed loop.
- Never run `c3x repair` without the `git status .c3/` revert step immediately after.
- Never `git checkout main`; never `git push`; never touch `PROGRESS.md`.
- Never add a `*Deps` interface under `src/server/**` — the budget is at 80/80.
- Never claim a gate passed without pasting its actual output.
- Report the pty failures as pre-existing **only** after Phase 2 step 4 has measured the baseline.
