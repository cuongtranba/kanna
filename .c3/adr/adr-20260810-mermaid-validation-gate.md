---
id: adr-20260810-mermaid-validation-gate
c3-seal: 53d5506b6d0eefcf526d350e5ad0932e808ec9814cd30dbaa469cac4ecb310d7
title: mermaid-validation-gate
type: adr
goal: 'Stop invalid Mermaid the model writes from reaching the transcript, by validating every diagram against mermaid''s real parser at creation time and feeding the parse error back so the model self-corrects. Two enforcement points: a `mcp__kanna__validate_mermaid` MCP tool the model calls before it emits a fence (in-turn, no extra turn), and a server-side end-of-turn guard that re-reads the turn''s assistant text and enqueues one bounded correction prompt when the tool was skipped. Removes the need to keep growing a hand-maintained table of mermaid spellings on the client.'
status: accepted
date: "2026-08-10"
---

## Goal

Stop invalid Mermaid the model writes from reaching the transcript, by validating every diagram against mermaid's real parser at creation time and feeding the parse error back so the model self-corrects. Two enforcement points: a `mcp__kanna__validate_mermaid` MCP tool the model calls before it emits a fence (in-turn, no extra turn), and a server-side end-of-turn guard that re-reads the turn's assistant text and enqueues one bounded correction prompt when the tool was skipped. Removes the need to keep growing a hand-maintained table of mermaid spellings on the client.

## Context

Kanna renders Mermaid inline (c3-114), so a syntax error is visible to the user as a broken diagram. A user reported `Couldn't render this Mermaid diagram — line 6, Unrecognized text` for a deployment flow whose labels were filesystem paths: `Install --> Current[/opt/cubedoc-kiosk-app/current symlink]`. `[/` is mermaid's parallelogram opener (flow lexer rule 95, `flowDiagram-I6XJVG4X.mjs`, mermaid 11.15.0) and must close `/]` or `\]`; the preceding line closed with `/]` by accident and parsed, this one closed with a bare `]` and the lexer died.

Four prior fixes did not close the class. PR #242 rendered mermaid; 80d2617 added an error badge; PR #621 made the parse error diagnosable (`mermaidError.ts` — line, summary, caret excerpt); PR #637 added a two-row `LINK_RULES` repair table (`-.x` → `-.-x`) plus a system-prompt sentence. Every one is either better reporting after the fact, or one more character added to a hand-maintained list — and both lists sit on the link-operator axis, while the reported defect is label content.

No list can close it. mermaid's `text` lexer state has exactly one plain-text rule, `/^(?:[^\[\]\(\)\{\}\|\"]+)/`, so an unquoted label is readable only while it holds none of `[ ] ( ) { } | "` — an open-ended set of ordinary prose and paths. The structural gap is that nothing ever checked the model's output: the system prompt asked nicely and the client cleaned up afterwards, so the model got no feedback and shipped the same defect again.

Feasibility was measured before deciding. mermaid needs a DOM, but far less of one than a full implementation: a ~20-line shim installed only around `await import("mermaid")` and restored in a `finally` makes `mermaid.parse` answer in ~9 ms in the Bun server, for every diagram type, with the real jison message — and no new dependency, since mermaid is already a production dep.

## Decision

Validate at creation, in two layers that cover each other, and stop growing the client repair.

**Layer 1 — `mcp__kanna__validate_mermaid` (c3-226).** A zod-shaped tool taking one `source`, returning `VALID` or an `isError` result carrying line, mermaid's caret excerpt, and an actionable hint. Registered whenever a `chatId` is present (subagents included); one `tool()` call reaches both drivers through `kanna-mcp-http.ts`. `isError` is deliberate — it is what makes the model treat the reply as work to redo. This is the primary path: the model fixes the diagram in the same turn and the user never sees the bad version.

**Layer 2 — end-of-turn guard (c3-210).** At the runner's real-turn success finalize, after `recordTurnFinished` and before `maybeStartNextQueuedMessage`, the guard extracts ```mermaid fences from the turn's `assistant_text` and validates them. Injected as an optional `RunClaudeSessionDeps.mermaidGuard`, so the runner stays IO-free. It borrows `wakeBackgroundTaskSession`'s enqueue shape (synthetic `autoContinue.scheduleId`, no schedule event) and NOT `deliverSubagentToMain`'s — deliberately no `/clear`, because the model needs the diagram in context to fix it.

The guard's bounds are the design, not defensiveness: it fires only when the reader would actually see an error (a diagram `repairMermaidSource` saves already renders with the correction banner), asks about a given diagram exactly once per chat, stands aside for a queued user message, skips errored and cancelled turns, swallows its own failures, and is disabled by `KANNA_MERMAID_GUARD=disabled`.

**Server-side mermaid via a scoped DOM shim, not happy-dom.** `mermaid-parse.adapter.ts` is the only server module that loads mermaid. `installDomShim` stands down entirely when a real `document` exists (the happy-dom the test preload registers process-wide), so it can never clobber a shared document. Its suite includes a subprocess run with no happy-dom — the only thing that proves the gate works where it will actually run.

**The client repair stays as it is.** No span tokenizer, no label-quoting pass: with validation catching diagrams at creation, re-implementing mermaid's grammar in Kanna's own code is not worth the maintenance. The client keeps its existing link rules and its honest error card for diagrams that arrive broken anyway (imported chats, old transcripts).

**Prompt drift becomes a build failure.** The system-prompt sentence is corrected to cover `/`, `\`, `|` and `"`, and `mermaid-prompt-drift.test.ts` asserts the prompt names every `LINK_RULES_FOR_PARITY` rule, every character forcing a quoted label, and the tool. It gates coverage, not prose.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-226 | component | Hosts the new `validate_mermaid` tool on the `mcp__kanna__*` surface, and owns the server's only mermaid load (`mermaid-parse.adapter.ts`) | c3-226#n10339@v1:sha256:67d28b28ac02ee49470782085f0c7e2effe42ad257d122006680fee767673cf0 "validate_mermaid tool" | rule-colocated-bun-test on the new tool; rule-strong-typing at the MCP envelope |
| c3-210 | component | The end-of-turn backstop hooks the runner's success finalize via a new injected `RunClaudeSessionDeps.mermaidGuard` dep and enqueues the correction through the coordinator | c3-210#n10341@v1:sha256:7e2a1c4e226e73adda61343b7d546334279137a7ebeb6aecb0dff9a25de13039 "Mermaid correction loop" | rule-colocated-bun-test on the guard; the guard must never fail a turn |
| c3-114 | component | Its lazy-chunk risk row cites `src/client/lib/lazyModule.test.ts`, which moved to `src/shared/` along with `mermaidError.ts` and `mermaidRepair.ts` so the server can reach them; the Lexical fence transformer now consumes the shared fence scanner | c3-114#n7510@v1:sha256:573b284a2227aa2387fb2096d15d3cf268c3113ed3b03ed15cdbd62e77760e4b "Stale lazy chunk" | rule-strong-typing on the shared modules |
| c3-0 | system | N.A - ancestor named only to complete the top-down descent | N.A - ancestor | N.A - ancestor |
| c3-1 | container | N.A - ancestor named only to complete the top-down descent to c3-114 | N.A - ancestor | N.A - ancestor |
| c3-2 | container | N.A - ancestor named only to complete the top-down descent to c3-226 and c3-210 | N.A - ancestor | N.A - ancestor |
| c3-3 | container | N.A - ancestor named only to complete the descent for the new `src/shared/mermaid-*` modules | N.A - ancestor | N.A - ancestor |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-local-first-data | The parser runs in-process on a local diagram string; nothing about a diagram leaves the machine and no new network surface is opened | ref-local-first-data#n9905@v1:sha256:6c1744cb29d49192d5bb3ac1662201087df01c9ee04f38fb3f53d04844e79485 "local-first-data" | comply |
| ref-strong-typing | `MermaidParsePort`, `MermaidValidation` and `MermaidDefect` are the named types at every boundary this unit adds — the MCP envelope, the guard dep and the shared validators | ref-strong-typing#n10009@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 "strong-typing" | comply |
| ref-tool-hydration | `validate_mermaid` is an ordinary `mcp__kanna__*` tool call and hydrates through `src/shared/tools.ts` like every other; it adds no bespoke transcript kind | ref-tool-hydration#n10042@v1:sha256:1cda574e5908fc3b6c85e5bbb9432e5edeee3a0c7d0d11e0230c45ac05c8a718 "tool-hydration" | comply — no new entry kind |
| ref-provider-adapter | The guard reads normalized `assistant_text` entries and never branches on provider; the runner hook is the same for SDK and PTY | ref-provider-adapter#n9938@v1:sha256:3bcf82b74f0f034db61a050837c7182691d29b77181e6f6c7805be1f2e00e180 "provider-adapter" | comply |
| ref-event-sourcing | The correction rides the existing `enqueueMessage` + `autoContinue.scheduleId` path (the `wakeBackgroundTaskSession` shape); no new event kind and no new `AutoContinueSource` variant, so replay is untouched | ref-event-sourcing#n9872@v1:sha256:ee0316401639d91b6d6f6b1c3615cf7eab1abbd5cbf9cef319474a29c2567775 "event-sourcing" | comply — no new event kind |
| ref-colocated-bun-test | Each new module lands with its colocated suite: the adapter, the guard, the four shared validators, the fence scanner and the prompt-drift pin | ref-colocated-bun-test#n9806@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 "colocated-bun-test" | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Every new server module in this unit (the tool, the adapter, the guard) and every new shared module ships a colocated `<name>.test.ts` | rule-colocated-bun-test#n10141@v1:sha256:2bc20e87f7c1e3aabe46c42732cca6d91bf2f72516544a2924fe9870e8df4385 "colocated-bun-test" | comply — 8 new colocated suites |
| rule-strong-typing | `MermaidParsePort` / `MermaidValidation` / `MermaidDefect` are the typed boundary; no `any`, no `unknown`, no `as` casts survived lint | rule-strong-typing#n10202@v1:sha256:eaa7509d80f8a56b00105ed5d46af5a604bfae2e81889e9dac7d7a095fbf5009 "strong-typing" | comply — `isMermaidModule` type guard replaces the module cast |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared contract | `mermaid-validation.ts` (`MermaidParsePort`, `MermaidValidation`, `MermaidDefect`), `mermaid-validate.ts`, `mermaid-hints.ts`, `mermaid-report.ts` | src/shared/mermaid-*.ts |
| Shared fence scanner | `mermaid-fences.ts` becomes the ONE definition of a fence; the Lexical `MERMAID_FENCE` transformer consumes it, fixing its closing-fence regex which omitted `*` after the whitespace class | src/shared/mermaid-fences.ts, src/client/components/lexical/markdown/messageTransformers.ts |
| Module moves | `mermaidError.ts`, `mermaidRepair.ts`, `lazyModule.ts` move `src/client/lib/` → `src/shared/` (all three already pure) | src/shared/ |
| Parser adapter | `mermaid-parse.adapter.ts` — scoped DOM shim + lazy mermaid, with a no-happy-dom subprocess test | src/server/mermaid-parse.adapter.ts |
| MCP tool | `buildValidateMermaidToolList` in `kanna-mcp.ts`, `KannaMcpArgs.parseMermaid` for test injection | src/server/kanna-mcp.ts |
| Backstop | `mermaid-guard.ts` + `RunClaudeSessionDeps.mermaidGuard` + per-coordinator wiring in `agent-deps-builders.ts` | src/server/mermaid-guard.ts, src/server/claude-session-runner.ts |
| Prompt | Corrected quoting sentence + the tool instruction, pinned by a drift test | src/shared/kanna-system-prompt.ts, src/shared/mermaid-prompt-drift.test.ts |
| Docs | CLAUDE.md "Mermaid Validation Gate" section | CLAUDE.md |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| `mermaid-parse.adapter.test.ts` | Drives the REAL mermaid: the kiosk diagram must be rejected blaming line 6, its quoted form accepted, and a subprocess with no happy-dom must reach the same verdict with no leaked globals | src/server/mermaid-parse.adapter.test.ts |
| `mermaid-guard.test.ts` | One test per bound — once-per-diagram, client-repairable diagrams cost no turn, queued user message wins, disabled is inert, failures are swallowed | src/server/mermaid-guard.test.ts |
| `claude-session-runner.test.ts` | Guard runs on success only, before the queued-message drain, and text never crosses a turn boundary | src/server/claude-session-runner.test.ts |
| `mermaid-prompt-drift.test.ts` | Fails CI when a repair rule exists that the system prompt does not warn about | src/shared/mermaid-prompt-drift.test.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Grow the client repair into a span tokenizer + label-quoting pass | Re-implements mermaid's grammar inside Kanna and must be kept in sync across mermaid upgrades — the same maintenance treadmill that produced four partial fixes. With creation-time validation the diagram never reaches the client broken in the first place |
| Promote happy-dom to a production dependency | It replaces the process's `fetch`/`Request`/`Response`/`FormData`/`Blob` — `scripts/test-preload.ts` exists partly to undo exactly that. Far too much blast radius for a parse |
| Shell out to a child process per validation | ~200 ms of spawn for a 9 ms parse, and a new process-management surface, to avoid ~20 lines of shim that is installed and torn down inside one function |
| MCP tool only, no backstop | Prompt-enforced. A model that skips the tool ships a broken diagram — precisely today's failure mode |
| Backstop only, no tool | Always costs an extra turn when a diagram is wrong, and leaves the broken version in the transcript above the fix |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| DOM shim leaks globals and a library takes a browser code path | Installed only when `globalThis.document` is absent, restored in a `finally`, confined to one `.adapter.ts` | Subprocess test asserts `windowLeaked: false, documentLeaked: false`; unit tests assert stand-down and restore |
| Correction loop — the model cannot fix its diagram and is asked forever | Bounded per-chat memory of asked sources (32), one correction turn per turn, plus the kill switch | `mermaid-guard.test.ts` "retries a given diagram exactly once" |
| Extra turn cost on diagrams the client already saves | The guard re-runs `repairMermaidSource` and skips anything the repair makes parse | `mermaid-guard.test.ts` "spends no turn on a diagram the client's repair already saves" |
| Guard throws and takes the turn with it | Whole body wrapped; failures logged at warn and swallowed | `mermaid-guard.test.ts` swallow tests for parser and enqueue failure |
| mermaid upgrade changes the shim surface or the grammar | The adapter suite loads the real mermaid, so a broken shim fails CI loudly instead of silently disabling the gate | `bun test src/server/mermaid-parse.adapter.test.ts` |
| Correction jumps ahead of the user's own message | `hasQueuedMessage` short-circuit | `mermaid-guard.test.ts` "stands aside when a user message is already queued" |

## Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun run lint` | clean at `--max-warnings=0` (no `as` casts, no `unknown`, seal respected) |
| `bunx ast-grep test` | 14 passed, 0 failed |
| `bun run test` | 5138 pass, 2 skip, 0 fail across 425 files |
| `bun run build:client` | built; mermaid still a separate lazy chunk (`mermaid-*.js`, `mermaid.core-*.js`) |
| `bun -e 'await import("./src/server/kanna-mcp.ts")'` | loads in ~109 ms with no DOM leaked — mermaid is not pulled in at server module load |
| Live check | Ask for a diagram with filesystem-path labels; confirm `validate_mermaid` is called, the diagram renders with no correction banner and no extra turn. Force the backstop with the kiosk diagram; confirm exactly one correction turn and no second retry |
