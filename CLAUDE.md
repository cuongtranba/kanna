# Project skills

`.claude/skills/kanna/SKILL.md` is the router — a symptom→skill table plus the
ground rules that hold for every task here. Read it first when you are unsure
which skill applies, or when a task spans several. The specialists it routes to
carry their own trigger phrases and fire on their own; the router exists so a
task that matches none of them cleanly still lands somewhere.

| Skill | Owns |
| --- | --- |
| `kanna` | Routing table + rules that apply to every task |
| `kanna-debug` | Reading a chat's transcript and event logs to explain what happened |
| `kanna-telemetry` | Adding spans/metrics, operating the otel-lgtm collector, the OTel adapter, perf alerts → GitHub tickets |
| `kanna-sessions` | SDK session + turn lifecycle: `/clear` `/compact`, compaction, queue, keep-alive, live blocks, teardown |
| `kanna-cron` | `/cron`: parser, repair, confirm, `arm_cron`, sub-minute schedules, run-event retention |
| `kanna-providers` | Model catalog, custom Anthropic-compatible endpoints, Codex failure classification |
| `kanna-mcp` | Custom MCP servers + OAuth, and Kanna's own remote `/mcp` server |
| `kanna-inbox` | Service bus, NATS mirror, Inbox, MCP sources, inbound webhooks |
| `kanna-genui` | Mermaid gate, Generative UI (`kanna-ui`), share links |
| `kanna-beacon` | Beacon file transfer, self-update, the Windows 7 Go port |
| `kanna-features` | Boards, hide/delete project, tus uploads, package auto-update, plugins, import live-tail |
| `kanna-react-style` | React + TypeScript conventions for `src/client/**` |
| `kanna-test` | Writing tests (no mocks, no sleeps, public seam); running them; the lint, ast-grep, design gates and ratchets |
| `kanna-loop` | Autonomous loops: `setup_loop`, the oracle, the durable task list, wake recovery |
| `kanna-subagents` | `delegate_subagent`, the spawn gate, keep-alive and background runs |
| `release` | Version bump + npm publish |
| `review-pr` | Security-focused PR review via the GitHub API |
| `github-issue` | Writing bug reports and feature requests detailed enough to implement from |

These files have two consumers — Claude Code auto-triggers on the frontmatter
`description`, and Kanna's own `/` picker parses the same files through
`LocalCatalogService` (`c3-231`). That parser is **line-based**, so a description
must stay on one line: a folded `>-` block silently becomes an empty description
in the picker. `user-invocable: false` hides a skill from the picker while leaving
auto-triggering intact.

Skills follow Anthropic's authoring guidance, and `src/ops/skills/skill-authoring.test.ts`
enforces its hard limits on every first-party skill (symlinked vendor skills are
skipped): `name` equals the directory, 1–64 lowercase letters, digits and hyphens;
`description` is one line, at most 1,024 characters, has no XML tags, and is
written in the third person ("Writes…; use when…", never "you"); the SKILL.md body
stays under 500 lines, with detail moved to reference files linked one level deep
from SKILL.md; and a reference file over 100 lines opens with a `## Contents`
section. `kanna-sessions` and `kanna-loop` predate the line limit and hold
shrink-only `LEGACY_BODY_ALLOWANCES`; split them, then delete the entry.

# Commands

```bash
bun install
bun run dev              # vite client on :5174 + server on :5175 (client port + 1)
bun run start            # single-process server, production shape
bun run install:dev      # build, then install this tree globally as the `kanna` CLI
```

Verification — `bun run check` is typecheck → lint → build:client → check:bundle:

```bash
bun run check
bun run test                                   # NEVER bare `bun test` (see TypeScript / Tests)
bun run test src/server/agent.test.ts          # one suite
bun run typecheck                              # TS7 by explicit path, not bare `tsc`
```

Gates that block a merge, each covering something the others do not:

```bash
bun run lint             # eslint --max-warnings=0: side-effect seal + design gate
bun run lint:usestate    # ast-grep: React #185 rules + inline tint pairing
bun run lint:limits      # proves the complexity ceilings are still TIGHT
bun run check:arch       # architecture budget ratchet
bunx ast-grep test       # rule-tests/ for the rules in rules/
bun run scan:secrets     # gitleaks over the working tree
bun run setup:hooks      # one-time: wire .githooks (pre-commit secret scan)
```

`bun run test:e2e` (Playwright, real Chrome) is deliberately off the CI critical
path — see Wiki. `bun run verify:client-arch` chains ast-grep + lint + typecheck
+ test for client work.

# Repo layout

```
src/server/      event-sourced server; *.adapter.ts are the only IO leaves
src/client/      React client (see kanna-react-style)
src/shared/      contracts both sides import — a type lives here ONCE
src/ops/         architecture budget, alerting specs, test-suite guards (outside the IO seal)
rules/           ast-grep rules; rule-tests/ holds their fixtures
scripts/         dev, bundle check, complexity limits, Grafana alert applier
e2e/             Playwright specs (*.pw.ts)
wiki/            Astro Starlight docs site, its own package.json and node_modules
.c3/             architecture facts, ADRs, eval bindings — query before coding
```

`c3x lookup <file>` maps a file to its owning component; `/c3 query <topic>`
loads the context. Do that before editing rather than inferring from the tree.

# Architecture

This project uses C3 docs in `.c3/`.

**MANDATORY for Claude Code AND Codex:**
1. **Before coding** — run `/c3 query <topic>` (or `c3x lookup <file>`) to load
   component context, refs, and rules. Do NOT skip even for "small" edits.
   Skipping = stale assumptions = wrong patches.
2. **After coding** — if change touches component boundaries, refs, public
   contracts, or rules, run `/c3 change` (or `/c3 sweep` for audit) to update
   `.c3/` docs in the SAME PR. Code-doc drift is a blocker.
3. **Architecture questions, audits, file→component lookup** — always `/c3`.

Operations: query, audit, change, ref, sweep.
File lookup: `c3x lookup <file-or-glob>` maps files/directories to components + refs.
Skill: `c3-skill:c3` (auto-triggers on `/c3` or architecture phrases).

**`c3x` can rewrite docs your change never touched — always `git status .c3/`
after ANY c3x write, `repair` and `change apply` alike, and `git checkout --`
what you did not intend.** `.c3/c3.db` is gitignored, so the canonical markdown
is the only source of truth and git is the only thing that catches this.

Most of that churn is cosmetic re-canonicalization (it strips inline-code
backticks from TABLE CELLS: `` `bun run lint` `` → `bun run lint`). **But it is
not always formatting-only — text can be LOST.** A table cell holding an escaped
pipe (`\|`, the only way to write a literal `|` in a cell) was rewritten as
`\ |`, which escapes a space instead. The pipe then reads as a column separator,
so the NEXT re-serialization truncates the row at the table's column count.
c3-210's `compactionTurn` row carried that broken escape from a193638 (#649)
until 36217ff, and lost 533 bytes mid-sentence on the way. If you see `\ |` in a
`.c3/` table cell, it is damage — restore `\|`.

A cell holding a glob pattern or any markdown-emphasis character inside backticks
is also damaged: the backtick strip leaves `*` or `_` unguarded, and the NEXT
serialization collapses them as markdown emphasis — silently discarding the
character. Reproduced in #881: `` `mermaid-*.js`, `mermaid.core-*.js` `` →
`mermaid-*.js, mermaid.core-*.js` → `mermaid-.js, mermaid.core-.js`. Any cell
that held `` `glob-*.ext` `` and now shows `glob-.ext` (missing `*`) is damaged.

**Restoring the backticks does NOT hold — that remedy buys exactly one cycle.**
Measured: re-backticking `mermaid-*.js` survives one `repair`, then the run after
that strips the backticks again and re-eats the `*`, which is why #881 kept coming
back. **Escape the character instead** — `\*`, `\_` — which renders literally, is
not a code span, and so survives repair indefinitely (verified over four
consecutive runs). The same holds for `__tests__/`, which collapses to `tests/`
unless written `\_\_tests\_\_/`, and for a `**` glob, written `\*\*`.

**A literal `|` in a table cell cannot be made durable at all** — `\|` is the only
markdown spelling and c3x truncates the row at it. Reword the cell so it needs no
pipe ("open" or "closed", `install / ls / reload`); every fix below did that.

Both defects are fixed in `cuongtranba/c3-skill` (the `insert-after` seq shift
and the table-row normalizer). Until a release ships with them, `change apply`
also fails on any `insert` after a non-last table row
(`UNIQUE constraint failed: index 'idx_nodes_order'`); build the fork and run
via `C3X_LOCAL_BINARY=<path> bash <skill-dir>/bin/c3x.sh …`.

**`repair` is idempotent on this tree as of 2026-08-22 — a second run changes
nothing, so ANY diff it produces is about YOUR change and worth reading.** It
was not, and the three causes are all authoring mistakes rather than tool bugs,
so they will come back the same way:

1. **An `.c3/adr/` file with no YAML frontmatter is DELETED, not skipped.**
   `adr-20260821-watch-arming-window-safety-net.md` was hand-written starting at
   `# adr-…`, so c3x did not recognise it as an entity and removed it on every
   repair. An ADR needs the `id`/`title`/`type`/`goal`/`status`/`date` block —
   `c3x add adr` writes it; hand-authoring means writing it yourself.
2. **One unsealed fact blocks EVERY cache rebuild**, and the error names only
   that file (`broken C3 seal in c3-1-client/c3-116-settings-page.md`) while the
   visible symptom is elsewhere: reads fall back to a stale cache, so facts
   added since — c3-234, c3-235 — resolve to nothing and `c3x lookup` answers
   "no component mapping" for files that are correctly bound.
3. **A wrapped list item loses its continuation indent.** c3x re-serialises
   `2. …\n   continued` as `2. …\ncontinued`, breaking the list. Keep list items
   on one line in `.c3/` prose; the normalizer then has nothing to mangle.

`goal:` frontmatter being rewritten to match the body's `## Goal` is c3x syncing
the two, not damage — the body wins.

Resolved: `c3-235` (secret scanning, from #820) now has its component fact at
`.c3/c3-2-server/c3-235-secret-scanning.md`, bound by `.c3/eval/c3-235.yaml` and
`code-map.yaml`.

**A PR that edits a `.c3/` body without re-sealing breaks the whole tree, and
nothing in CI catches it.** #1053 added three lines to
`c3-1-client/c3-110-app-shell.md` and left `c3-seal` alone; `c3x check` then
failed on that one file, which per (2) above blocks EVERY cache rebuild — so
`c3x lookup` answered "no component mapping" for correctly-bound files like
`.gitleaks.toml`, and the tree stayed that way until it was found by hand. Run
`c3x check` after touching `.c3/`; it is the only thing that reports this.

**`c3x lookup` is now functional via `.c3/eval/<fact>.yaml` bindings.** Every
production-significant component has a spec file at `.c3/eval/c3-NNN.yaml` with
a `code:` list of its files and globs — `c3x lookup <file>` reads those to map a
file back to its owning fact. `code-map.yaml` is a secondary index kept in sync
for reference; the eval files are the authoritative source for `lookup`.

**Maintaining eval bindings.** When you add a new architecture-significant file:
1. Identify its owning component (use `c3x search` or read nearby components).
2. Add the file path to `code:` in `.c3/eval/c3-NNN.yaml`.
3. Also add it to the matching entry in `.c3/code-map.yaml` for consistency.
4. Run `c3x repair` (no warnings) then `c3x lookup <file>` to confirm resolution.

When a file is **renamed to `.adapter.ts`** (IO seal enforcement): update both
`.c3/eval/c3-NNN.yaml` and `.c3/code-map.yaml` to reflect the new path.

When a file is **deleted**: remove its entry from both files — stale anchors
surface as warnings on `c3x repair`/`c3x check`; keep those clean.

# Pull Requests

`origin` = `cuongtranba/kanna` is the ONLY remote. There is no `upstream`, and
no other repository is a valid PR target.

`gh repo set-default` is NOT set, so `gh pr create` with no explicit target
prompts or guesses. Always pass `--repo cuongtranba/kanna` or
`--base main --head <branch>` to make the target explicit.

# TypeScript (dual install: TS7 compiler + TS6 API for tooling)

Type checking runs on **TypeScript 7** (native compiler). typescript-eslint
has no TS7-compatible release yet (TS7 dropped the compiler JS API from
`require('typescript')` — it now exports only `{version}`; the API moved to
`typescript/unstable/*`), so two TypeScript packages are installed:

- `"typescript": "6.0.3"` — classic TS6 with the full legacy JS API
  (`createProgram`, `ModuleKind`, …) that typescript-eslint's parser loads
  via `require('typescript')`. Peer range `<6.1.0` is satisfied.
- `"typescript-7": "npm:typescript@^7.0.2"` — the real TS7 compiler used for
  the actual type check.

Both packages ship a `tsc` bin, so **never** rely on bare `tsc` / `bunx tsc`
(the `.bin/tsc` link is ambiguous). The `typecheck` script invokes TS7 by
explicit path (`node_modules/typescript-7/bin/tsc --noEmit`); CI's Type-check
step and the local `check` script both call `bun run typecheck`. When
typescript-eslint ships TS7 support, collapse back to a single `typescript`
dep and restore `bunx tsc`.

# Lint

`bun run lint` runs ESLint on `src/` with `--max-warnings=0`. CI runs it
before tests; merges blocked on lint errors AND on any warning count above
the cap. The cap is a ratchet: when warnings drop, lower the cap in the
same PR so they cannot creep back up. Plugin `react-hooks` (set 7+) enforces
React 19 rules: `rules-of-hooks`, `purity`, `globals` are errors;
`set-state-in-effect`, `refs`, `immutability`, `preserve-manual-memoization`,
`exhaustive-deps` are warnings.

# No Code Comments (MANDATORY — `bun run lint:comments`)

**First-party TypeScript under `src/`, `scripts/` and `e2e/` carries no
comments.** Not a leading `//`, not a trailing one, not a `/* */` block, not a
`/** */` JSDoc, not a `{/* */}` JSX container. The code is the documentation:
say it in a name, a type, or a small named function. If a fact genuinely cannot
live in code, it belongs in `CLAUDE.md`, a `.c3/` fact, an ADR, or the wiki —
places a reader can search, and that `c3x check` and the docs build can hold to
account. A comment is none of those: nothing verifies it, so it rots in place
and outlives the code it describes.

**The only survivors are comments a TOOL executes.** These are not prose; they
change what the compiler, the linter or the bundler does, and deleting one is a
behavior change rather than a cleanup:

| Kept | Why |
| --- | --- |
| `eslint-disable`, `eslint-disable-next-line`, `eslint-disable-line`, `eslint-enable` | Suppression is ESLint's own syntax; removing it fails `bun run lint` |
| `/// <reference ... />` | A TS triple-slash directive — part of the program's type graph |
| `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck` | Read by `tsc`; none exist today and none should be added, but the stripper must never eat one |
| `@vite-ignore`, `webpackChunkName` | Bundler magic comments inside `import()`; they steer chunking and dynamic resolution |
| `prettier-ignore`, `biome-ignore`, `ast-grep-ignore`, `istanbul ignore`, `c8 ignore` | Other tools' suppression syntax |
| `@license`, `@preserve`, `SPDX-` | Legal text a minifier is required to keep |
| A `#!` shebang on line 1 | Not a comment — it is how the kernel picks the interpreter |

An `eslint-disable` still needs its rationale. Put it on the same line after
`--`, which is ESLint's own description syntax and therefore part of the
directive rather than a second comment:

```ts
// eslint-disable-next-line react-hooks/refs -- render-time sync write so an
// async completion between render and commit refuses to overwrite a stale key.
```

**Out of scope, deliberately:** `wiki/` (its own package, and a docs site is
prose by definition), `rules/*.yml` and `rule-tests/` (ast-grep fixtures —
several PIN a comment as the thing under test), `.c3/`, `.github/`, and root
config files including `eslint.config.js`, whose comments are the only record of
why each design gate exists.

**Enforced.** `bun run lint:comments` (`scripts/check-no-comments.ts`) parses
every in-scope file with the TypeScript scanner — never a regex, which cannot
tell a comment from `"https://…"` inside a string — and fails with
`file:line` for each survivor. It runs inside `bun run check`. Re-strip an
offending tree with `bun run strip:comments`.

**Two facts the stripper had to learn, and any replacement will too.** A JSX
comment is a `JsxExpression` with no expression, so deleting only the comment
leaves `{}` — which is a syntax error as a JSX child, not an empty node; the
whole container has to go. And `/** */` on an `export`ed symbol is still a
comment: editors lose the hover text when it goes, which is the accepted cost
of this rule and not a bug to route around by reintroducing JSDoc.

# Type Strictness — an untyped value has no legal spelling

`bun run lint` bans `any` (`@typescript-eslint/no-explicit-any`), BOTH cast
spellings, and `unknown` in **every** position. There is no escape valve; do not
add `eslint-disable` comments.

**The rule counts the CONCEPT, not one keyword** — the same lesson
`deps-bundles` records below. The predecessor selected
`TSTypeAnnotation > TSUnknownKeyword`, a DIRECT annotation only, so
`Record<string, unknown>`, `unknown[]`, `Promise<unknown>` and `unknown | null`
were all legal: 274 in production, including `error: unknown | null` in
`shared/types.ts`, which is a one-token evasion of the exact rule it evades.
`AS_CAST_BAN` matched `TSAsExpression` only, so `<T>x` was legal too — 18 sat in
production, four of them spelled `<Record<string, AnyValue>>`.

**The gap grew its own institution, and that is the part to not repeat.**
`src/shared/errors.ts` exported `type AnyValue = unknown`, which reached **458
sites across 120 files** while satisfying the rule perfectly;
`plugin-http-routes.ts` documented the motive out loud ("`AnyValue` rather than
the `unknown` keyword, which this repo bans"). `quick-response.ts` is the
reductio — it spelled one signature `AnyValue` and the identical signature
`unknown | null` forty lines apart. Renaming removes nothing.

**Say what the value IS.** Most of those 458 were parsed JSON, so they now have
a real type:

| Boundary | Type | Module |
| --- | --- | --- |
| parsed JSON — `JSON.parse`, `res.json()`, SQLite text, protocol payloads | `JsonValue` / `JsonObject` / `JsonArray` | `src/shared/json.ts` |
| a caught or rejected throwable | `Error`, via `toError()` / `onRejected()` | `src/shared/errors.ts` |
| a dynamic `import()`/`require()` namespace, a `globalThis` slot | `LoadedModule` / `HostBag` | `src/shared/dynamic-module.ts` |

`JsonValue` is strictly more informative than `unknown` and no less safe: it
still cannot be used without narrowing, but narrowing it LANDS somewhere —
indexing a `JsonObject` yields `JsonValue`, where `isRecord`'s
`Record<string, unknown>` yields `unknown` and drops you back out of the type
system. **When a parameter is `JsonValue`, use `isJsonObject`, not `isRecord`.**

`errors.ts` and `dynamic-module.ts` are the only files exempt from the unknown
ban, and each names ONE kind of untyped value rather than "anything at all".
`LoadedModule`/`HostBag` are themselves banned outside a short enumerated file
list in `eslint.config.js` — that list is what makes them not a second
`AnyValue`, because spreading them costs a visible diff to the lint config.

**Two facts that will bite you.** A TypeScript `interface` never satisfies an
index-signature type, so (1) a predicate must be written
`v is JsonValue & Foo`, not `v is Foo` (TS2677), and (2) a domain interface
reaching a JSON field needs an explicit field-by-field encoder — never a cast,
and never `JSON.parse(JSON.stringify(x))` on a hot path.

**The ack channel has no residue.** Every command in the registry
(`src/shared/commands/`) declares a `result` zod schema, and
`CommandResult<C>` is its output type, so the ack envelope's `result` is the union
of those outputs rather than a loose `object`. A command that acks with nothing
declares `noResult` (`z.undefined()`): `ackResult(id, command)` takes no result
and compiles only for such a command, and `kanna_commands` renders the schema as
`{ "not": {} }` with a description saying the ack carries no result and the
remote MCP server reports it as `{"ok":true}`. A handler answers through
`ackResult(id, command, result)`, so a reply of another shape fails to compile.
`socket.command(command)` resolves to that type and there is no overload that
takes a type argument, so a client cast is not expressible. `defineCommand`
requires `result`, so a command cannot ship without one. A type that already
exists for a result is tied to its schema with `assertParity`. The hot-path
payloads (`TranscriptEntry[]`, `ChatHistoryPage`) are typed by schema and never
parsed on the client. The one handler that does not use `ackResult` is
`backgroundTasks.getOutput`, which answers with a `snapshot` envelope; its
schema describes that snapshot and a parity check ties it to `ServerSnapshot`.

# Architecture Budget (ratchet — `bun run check:arch`)

`src/ops/architecture/budget.ts` pins the size of every structural-defect
population the #889 program is driving down, and `budget.test.ts` fails CI when
one grows. It exists because the previous complexity program (#674–#681) closed
all seven workstreams as COMPLETED while its own metrics moved the wrong way —
modules over 700 lines went **18 → 21 → 23** and production LOC rose from
~121,700 to ~125,779. Nothing in CI could observe that, so nothing objected.

Two budgets, deliberately shaped differently:

- **`MODULE_ALLOWANCES`** — a per-file **ceiling** for each module over
  `MODULE_LINE_THRESHOLD` (700). A listed module may shrink freely, may never
  grow past its pin, and **must be delisted once it drops under the threshold**
  (`module_delistable`) so the allowance cannot be reclaimed later. A new file
  crossing 700 fails as `module_unlisted`. It is a ceiling rather than an exact
  pin because this repo routinely has 15+ live worktrees and exact line pins
  would make every parallel edit to a large module a manifest merge conflict.
- **`PATTERN_BUDGETS`** — an **exact ratchet** on counted defect populations
  (`deps-bundles`, `ws-router-dispatch-arms`, …).
  Growing fails; **shrinking also fails**, because a pin left above the real
  count is a pin the population can creep back up to. Each entry carries the
  `issue` it regresses and a `rationale`, so a breach message says which filed
  issue this PR just made worse rather than printing a bare number.

**ESLint owns the complexity measurement; the budget owns the direction.**
`eslint.config.js` sets four production ceilings — `complexity` 127,
`max-params` 11, `max-depth` 7, `max-nested-callbacks` 4 — at today's maxima, so
they are unbreached but hard. `ESLINT_LIMIT_PINS` must **equal** each configured
value: raising the ceiling fails `check:arch` as `limit_raised`, and lowering it
without lowering the pin fails as `limit_slack`. The adapter reads the real
`eslint.config.js` rather than a transcription, so pin and enforced value cannot
agree on paper while disagreeing in fact. A pin whose rule ESLint no longer
configures fails as `limit_unconfigured` rather than passing vacuously.

The peaks are the audit's own findings, which is why these are defect counts and
not style knobs: `complexity` 127 is the `SettingsPage` component (`runClaudeSession`,
once the peak, is 122 since the PTY driver's `compact_boundary` finalize branch was
deleted; `handleCommand` in `ws-router.ts` is 116), `max-depth` 7 is
`runClaudeSession`'s `for await` loop, and `max-params` 11 is `deriveChatSnapshot`.

**`bun run lint:limits` proves a ceiling is still TIGHT.** A ceiling nothing
reaches gates nothing — pinned at 141 while the worst function is 90 leaves 50
points of free regression. The script runs ESLint once with every ceiling lowered
by one and requires each rule to report at least one production violation. It is
the analog of `pattern_shrank` for a measurement a regex cannot make, and it
reuses `PRODUCTION_EXCLUDES` so "production" means one thing.

**A pattern must count the CONCEPT, not one keyword.** `deps-bundles` first
matched only `interface [A-Za-z]*Deps`, and #914 satisfied it by respelling one
bundle as an inline `deps: {` parameter — the commit message said so outright.
Renaming removes nothing, so the ratchet was driving cosmetic churn instead of
deletion, which is precisely the failure #889 exists to stop. The pattern now
matches the named interface, the named type alias, and the inline parameter
object alike, and the pin was re-baselined 79 → 82 (the original number was an
undercount, not a regression). A colocated test asserts all three spellings
match and that a mere *reference* to a bundle does not, so the pattern cannot be
silently re-narrowed.

When a budget fires, check whether the cheapest way to satisfy it is a rename.
If it is, the pattern is measuring a spelling rather than the defect.

**A budget graduates, it does not settle at a residue.** Once its issue lands and
the type system or a lint rule enforces the property permanently, delete the entry
rather than pinning whatever the regex still matches.
`harness-optional-payload-guards` was removed when #890 shipped the `HarnessEvent`
discriminated union (#908): narrowing became a compile error, and the two
remaining regex hits were false positives (`!event.entry.isError`, and a `!==`
comparison). Pinning them would have implied a defect that no longer exists — the
compiler is the stronger gate, so the weaker one is retired.

**A pin is a defect count, never a style preference.** Raising one is a visible
diff that says the PR made a tracked issue worse; the correct response to a
breach is almost always to put the new code in a module that owns it.

**Test files have their own ratchet, `TEST_PATTERN_BUDGETS`** (same file, same
exact-pin semantics, #1375). It counts the test-policy defects the lint does not
reach: `mock()`/`spyOn` function mocks, global patches (`Date.now =`, `fetch`,
`window.confirm`, `console.*`, `process.env`), sleeps, `.only`, `.skip`,
`as unknown as`, and nested `describe`s, over `*.test.ts(x)` in `src/beacon`,
`src/client`, `src/server` and `src/shared`. `src/ops` is out of scope because its
gates quote every pattern as a literal. A test that needs a clock, dialog, logger
or fetch takes it as a parameter defaulting to the production value; see the
`kanna-test` skill.

**`filesScanned` is load-bearing.** A budget whose `include` no longer resolves
(target renamed) would otherwise report as a population that shrank to zero —
inviting someone to pin it at `0` and **silently retire the check instead of the
defect**. A zero-file scan is therefore reported as `pattern_unmeasured`
("this gate is currently inert"), never as a shrink.

Counts match `grep -c`: matching **lines**, not matching occurrences, so any pin
is checkable by hand. Module lines match `wc -l` (newline count). Tests,
`__fixtures__`, `test-helpers` and `testing` directories are excluded from both
scans — production surface only.

`src/ops/**` is outside the side-effect seal, but the split is kept anyway:
`budget.ts` is pure (manifest + `checkModuleBudget` / `checkPatternBudget` /
`formatBreach`) and `budget-scan.adapter.ts` is the only file that touches the
filesystem.

# Side-Effect Lint (ports-and-adapters seal)

Side effects (`node:fs`, `chokidar`, `bun:sqlite`/`better-sqlite3`/`pg`,
`node:child_process`, `node:http`/`https`, `Bun.spawn`/`Bun.$`/`Bun.file`,
`new Database`, `process.exit`, `process.env`) are **sealed at `error`
across both `src/shared/**` + `src/client/**` AND `src/server/**`
production code**.

`no-restricted-imports` + `no-restricted-globals` + `no-restricted-syntax`
in `eslint.config.js` make every flagged import / global / call fail
`bun run lint`. Browser-native `fetch` is intentionally allowed in
shared/client. There is no escape valve; do not add `eslint-disable`
comments.

**Server layer exempt globs** (where direct IO is allowed):
`src/server/**/*.test.ts(x)`, `src/server/__fixtures__/**`,
`src/server/test-helpers/**`, `src/server/adapters/**`, and any file
matching `src/server/**/*.adapter.ts`.

**`.adapter.ts` filename convention.** Any file whose single
responsibility is to perform the side effect on behalf of a port
interface MUST be suffixed `.adapter.ts` and colocated next to its
port. Mixed-concern modules (domain logic + IO) extract their IO into
a sibling `*-io.adapter.ts` instead of renaming the parent.

**Adding new IO.** New IO requires either (1) putting the call in a
file matching one of the exempt globs above, or (2) injecting the
operation through a typed parameter / port interface. Adapter files
are leaf modules — they wrap one node/Bun primitive and have no
domain logic, so they are safe to import from anywhere that needs
the operation.

Authored across PRs #283 (pure-layer seal), #285 (paths-config
purify), #286 (call-site selectors), #287 (ratchet infrastructure),
#288–#302 (burn-down 90 → 0), and the final flip (server override
moved to `error` + ratchet tooling deleted).

# Commit messages must parse for release-please

release-please parses every commit since the last tag with
`@conventional-commits/parser`. When that parser THROWS it logs `commit could
not be parsed`, **drops the commit** — from the changelog AND from the version
calculation — and exits 0. The workflow is green, the release PR simply lacks
the entry, and nothing reports a problem.

Two commits were lost that way: **#1057** (`feat(motion)`, the entire motion
layer) and **#1047** (`refactor(types)`). Neither appears anywhere in
`CHANGELOG.md`. The omission is the visible cost; the latent one is worse — a
window whose only `feat` is dropped is bumped as a patch, or not released at
all.

**The trigger, verified against the parser:** a body line that BEGINS with
`word(` is read as a `type(scope):` header, so a nested `(` before the closing
`)` breaks it. `` `calc(2 * var(--motion-carry))` `` at the start of a line
throws; `see `calc(2 * var(--x))`` on the same line does not, and a `-`/`*`
bullet in front of it is fine too.

**The gate runs the REAL parser, never a regex over that shape**
(`src/ops/release/commit-message.ts` + `scripts/check-commit-messages.ts`).
Reproducing release-please's own verdict is the only check that cannot drift
from it — a regex tuned to the known trigger would pass the next message that
breaks the parser some other way. The test pins a real failing message, so a
parser upgrade that stopped rejecting it fails loudly instead of quietly
passing everything.

Two layers:

- **`.githooks/commit-msg`** — checks the message as it is written, the
  earliest point. Stands down when bun is absent (CI still enforces), like the
  gitleaks `pre-commit` hook. `bun run setup:hooks` wires both.
- **CI job `commit-messages`** (`test.yml`, PR-only) — checks every commit in
  the PR range PLUS the PR title, because a squash lands the title as the
  subject and the commits as the body. It needs `fetch-depth: 0`; with the
  shallow default the range is empty and the job passes having checked nothing.
  The PR title rides an **env var**, never a `${{ }}` interpolation — it is
  attacker-controlled on a fork PR. All three are pinned by
  `commit-message-workflow.test.ts`.

Run it by hand with `bun run check:commits --range origin/main..HEAD`.

# Secret Scanning

**Tool:** `gitleaks` pinned at **v8.30.1**, image `zricethezav/gitleaks:v8.30.1`, config at `.gitleaks.toml`.

**CI gate** (`.github/workflows/gitleaks.yml`) runs on every push to `main` and every PR; merges are blocked on any finding. The pre-commit hook (`.githooks/`) runs the same scan locally — `bun run setup:hooks` wires it.

**Two non-obvious v8.x facts that stale tutorials get wrong:**

- **`gitleaks protect` does not exist in v8.x.** The staged-scan command is `gitleaks git --staged`. An agent seeing an older tutorial will "fix" the hook to `protect`; it would break silently.
- **`gitleaks dir` does not respect `.gitignore`.** No flag exists on v8.30.1 to enable that. The `.gitleaks.toml` `paths` allowlist exists for this reason — deleting it takes a local scan from 11 findings to 112.

**Exemption mechanism.** A new test fixture that contains a synthetic credential needs one narrow `regexes` entry in `.gitleaks.toml` anchored to the literal fixture value — never a `paths` entry over `src/**` or `*.test.ts`. One placeholder credential = one regex line, added in the same PR that introduces the fixture. `stopwords` covers short dummy values that would be too broad for a regex.

**Version policy.** The upstream `gitleaks/gitleaks` project is effectively feature-complete and ships security patches only. The intended successor is [Betterleaks](https://github.com/betterleaks/betterleaks). The exact pin exists deliberately — do not float it. Revisiting the tool is a conscious future decision, not a routine upgrade.

**Leak response runbook:** see the wiki's [Secret Scanning](https://kanna-wiki.lowbit.link/guides/contributing/secret-scanning/) page. The summary: **rotate the credential first**, then remove it from the tree. History rewrite (`git filter-repo` / BFG) breaks every open PR and worktree — rewrite only when the credential cannot be rotated; a rotated credential in history is inert.

# Design System (MANDATORY)

`DESIGN.md` (repo root) is the single source of truth for Kanna's visual
system — the warm rose-tinted OKLCH palette (hue ~13°), the Body / Bricolage
Grotesque / Roboto Mono type pairing, and all named rules. Live tokens are
defined in `src/index.css` and consumed as Tailwind theme vars
(`bg-background`, `text-foreground`, `text-destructive`, `bg-warning`, …).
**Load `DESIGN.md` before any `src/client/**` UI work.**

**Hard gate (enforced, `bun run lint --max-warnings=0`).** `eslint.config.js`
`DESIGN_GATE_SYNTAX` (applied to `src/shared/** + src/client/**` via
`no-restricted-syntax`) bans:

1. **Arbitrary hex Tailwind utilities** (`bg-[#…]`, `text-[#…]`, `border-[#…]`,
   …) — use a token class instead.
2. **Raw hex color literals** — 6/8-digit (`#rrggbb`, `#rrggbbaa`) plus the
   pure black/white family (`#000`/`#fff`/`#000000`/`#ffffff`). 3-digit hex is
   NOT banned generally (it collides with issue refs like `#333` inside string
   literals); only the black/white forms are. Use CSS vars / token classes.
3. **`backdrop-blur` / `backdrop-filter`** (No-Glassmorphism Rule) — use a solid
   `bg-background` surface.
4. **Native `title` on intrinsic elements** — use the project Tooltip
   (`src/client/components/ui/tooltip.tsx`) via the `TruncatedText` /
   `HoverHint` helpers in `src/client/components/ui/truncated-text.tsx`.
   `iframe` is excluded (its `title` is the WCAG accessibility name, not a
   tooltip); PascalCase component props named `title` are not matched.

**Sanctioned chokepoint:** `src/client/components/chat-ui/TerminalPane.tsx` is
exempt from rule 2 only (xterm's `ITheme` API takes hex strings, not CSS vars).
No other exemptions; do not add `eslint-disable` comments.

**Contrast gate (enforced, two layers).** Semantic tinted pill surfaces
(`bg-{color}/10`) must use a `-text` token, not the raw color or `-foreground`.
Raw and foreground tokens fail WCAG AA on one or both themes when composited over
a tinted dark surface.

- `bun run lint:usestate` (ast-grep, `rules/no-inline-tint-pairing.yml`): bans
  inline `text-{color}[-foreground]` + `bg-{color}/` pairs in `src/client/**`.
  Derive classes from `STATUS_PILL_CLASS` or `TONE_PAIRINGS` in
  `src/shared/design/tone-pairings.ts`.
- `bun run test src/server/design/tone-pairings.test.ts`: asserts WCAG AA
  (≥4.5:1) for every `TONE_PAIRINGS` entry × {light, dark}, compositing
  `bg-{color}/{alpha}` over the real base surface via pure OKLCH → WCAG math
  (`src/shared/design/contrast.ts`, `tokens.ts`). Adding a new semantic tint
  context means adding an entry to `TONE_PAIRINGS` and confirming the test
  passes before touching any component.
- `bun run test src/server/design/raw-ink-guard.test.ts`: **a raw semantic
  token is a background, never ink.** `--warning`/`--info`/`--success` are
  chosen to be legible as fills and fail AA as text; the `-text` variants
  exist for that. `bg-warning` on a dot is correct, `text-warning` on a label
  is a bug. The guard scans `src/client` + `src/shared` and fails on any
  `text-{semantic}` outside ONE documented exception — a diff's own body in
  `FileContentView`, which is verbatim material. The tally beside it is not
  exempt. It also asserts every exemption is still NEEDED, so a stale one
  cannot be reused to smuggle a new violation in.

**The catalog measures what is drawn.** Status is a mark on a plain surface
now (`src/client/lib/stateMark.ts`), so the four `status/*` tinted-pill
pairings were replaced by `mark/*` + `ink/*` entries at `alpha: 1`. When a
pairing's last consumer is deleted the pairing goes with it — otherwise the
suite proves contrast for a surface nothing renders, which is a check that
gates nothing. `STATUS_PILL_CLASS` is now
`Record<"outdated"|"partial"|"unknown", string>`: package update availability
is the one context that still wants a tinted pill.

**Guidance-only (NOT linted — semantic, would false-positive).** Follow by
hand:
- No pulse/glow on status **dots** (`animate-pulse` is fine for skeletons/
  typeaheads).
- Kanna Coral on ≤10% of a screen; brand mark + destructive intent only.
- `tabular-nums` on every duration / count / age / pid / live ticker.
- Flat by default; depth via contrast + 1px soft edge, not shadow.
- Pair color with icon / label / weight; color alone never communicates.

The `impeccable` PostToolUse design hook also flags off-ramp font sizes and
other heuristics; those are advisory, not part of this lint gate.

# Render-loop regression checks

When introducing a new `use*Store` selector or any React hook that derives
collections, the selector MUST return a stable reference. Inline `?? []` or
`?? {}` produces fresh refs each call and triggers React error #185
(`Maximum update depth exceeded`). Pattern to use:

```ts
const EMPTY: Subagent[] = []
useStore((state) => state.list ?? EMPTY)
// or
useStore(useShallow((state) => state.list ?? []))
```

Tests can mount a component with effects and assert no loop warnings via
`renderForLoopCheck` in `src/client/lib/testing/`.

**Hard AST gate (ast-grep, wired into CI via `bun run lint:usestate`).**
Two rule pairs in `rules/` (tsx + `-ts` typescript variants, tests in
`rule-tests/`, run `bunx ast-grep test`) ban the React #185 class at
`severity: error`:

- `no-unstable-hook-fn-arg` — an inline arrow/function passed as a
  direct argument to ANY custom hook (`use[A-Z]...`). A hook that keys
  an internal effect on that argument re-runs the effect every render
  (react-use-websocket's reconnect effect on its url arg caused PR
  #561's flushSync loop). Bind with `useCallback`/`useMemo` or hoist.
  Safe-list (exempt): React built-ins that ref-stash or read the arg
  once (`useMemo`/`useCallback`/`useEffect`/`useLayoutEffect`/
  `useInsertionEffect`/`useImperativeHandle`/`useState`/`useReducer`/
  `useRef`), `useShallow`, and zustand `use*Store` selectors.
  `useSyncExternalStore` stays FLAGGED (inline subscribe resubscribes
  every render). A hook proven to ref-stash its callbacks may be added
  to the safe-list regex in both rule variants, in the same PR.
- `no-unstable-selector-fallback` — a `use*Store` selector returning
  inline `?? []` / `?? {}` (or `|| []` / `|| {}`) without `useShallow`.

A third pair bans a concurrency anti-pattern ESLint does not cover:

- `no-await-in-promise-all` — an `await` inside a `Promise.all([...])` array.
  Every awaited element settles before `Promise.all` ever sees a pending
  promise, so the call parallelises nothing and the work runs sequentially.
  Awaiting INSIDE an async callback passed to `.map()` is fine and stays valid.
  Adopted from the ast-grep TypeScript catalog; zero violations at adoption, so
  it is a true hard ban rather than a ratchet.

The catalog's `no-console-except-error` was deliberately NOT adopted: ESLint
already enforces `no-console` as an error with `src/shared/log.ts` as the
sanctioned chokepoint (`eslint.config.js:211,346-349`), and a second rule
stating the same decision is exactly the duplication this repo is removing.

Two further rules keep state TRANSITIONS in the store (ADR
`adr-20260802-ban-jsx-inline-state-logic`, `rule-zustand-store`). Both are
**tsx-only on purpose** — `jsx_attribute` does not exist in the typescript
grammar, so a `-ts` twin is impossible, not merely redundant; do not "fix"
the missing pair:

- `no-jsx-inline-state-updater` — a functional updater (`setX((prev) => …)`)
  passed to a `set*` call inside a JSX attribute. Replace the updater-shaped
  setter with a named action that derives the previous value INSIDE the
  store, then delete the setter from the state interface.
- `no-jsx-inline-state-logic` — an inline JSX-attribute arrow that calls a
  mutation-shaped identifier and is more than a single call (a block body
  with 2+ statements, or a lone `if_statement`). Two remedies, chosen by
  what the handler closes over: a PURE transition becomes one named store
  action; orchestration over props, refs, or async I/O becomes an extracted
  `useCallback` — stores never absorb props, refs, or I/O, and a `useRef`
  stays a `useRef`. The callee regex is deliberately broader than
  `^set[A-Z]` (it covers `toggle|clear|reset|open|close|…`) because migrated
  actions carry those verbs; introducing a NEW action verb means extending
  the regex AND adding a `rule-tests/` case in the same PR. Never silence a
  false positive with an `ignores` entry — extract the handler, or add a
  `not:` clause plus a pinning fixture.

# React Frontend Rules (MANDATORY when touching src/client)

When editing or adding React code under `src/client/**`:

1. **Reference stability first.** Any value passed to a hook that feeds
   effect deps (urls, configs, selectors, derived collections) MUST be
   reference-stable across renders: hoisted constant, module-level
   `EMPTY`, `useMemo`/`useCallback`, or `useShallow`. Never an inline
   arrow/object/array where a library effect-keys on it.
2. **Hook callbacks are gated generically.** `no-unstable-hook-fn-arg`
   already flags inline functions to any custom hook. Never weaken it by
   safe-listing a hook without proof it ref-stashes its callbacks; for a
   NEW anti-pattern shape (not a fn-arg), add a rule pair in `rules/` +
   test in `rule-tests/` in the SAME PR — a doc note alone is not a gate.
3. **Loop-check tests.** Components with effects that write stores should
   be covered by `renderForLoopCheck` (`src/client/lib/testing/`).
4. **Verify before done:** `bunx ast-grep test`, `bun run lint:usestate`,
   `bun run lint`, and for UI behaviour changes open the browser.
5. **Every side effect shows it is in flight.** A control that sends a WS
   command or an HTTP request renders a pending state until it settles —
   see **Pending state for side effects** below.

# Pending state for side effects (MANDATORY — hard gate in `bun run lint`)

The client used to fire side effects with no feedback: `onClick={() => void
handleArchive()}`, `socket.command(x).catch(() => {})`, async handlers passed to
props typed `() => void`. The click appeared to do nothing until the server
answered, a double click sent the command twice, and a failure vanished. 235 such
sites were fixed in one pass; the gate below exists so they cannot come back.

**The one primitive** is `src/client/stores/pendingActionsStore.ts`:

- `runPendingAction(key, () => doIt())` — marks `key` in flight, runs the action,
  clears it on settle, logs a rejection, and **ignores a second trigger while the
  first is still in flight**. It returns `void`, so it is legal in any handler.
- `usePendingAction(key)` — the trigger renders this flag.
- `pendingActionKey(scope, ...ids)` — scope is the WS command type
  (`"chat.archive"`, `"cron.remove"`), plus the entity id for a per-row action so
  only that row reads as busy.

Render it with `<Button pending={pending}>` (disables it, sets `aria-busy`, adds a
spinner), or for a non-Button trigger `disabled` + `aria-busy` + `<Spinner />`
(`components/ui/spinner.tsx`). A trigger inside a menu that closes on click shows
the pending state on the row it acts on, because the menu item is gone.

**Hard gate** (`eslint.config.js`, type-aware, `src/client/**` minus tests):

| Rule | Rejects |
| --- | --- |
| `@typescript-eslint/no-floating-promises` with `ignoreVoid: false` | a promise nobody settles, including `void promise` — the exact spelling of every silent button. `navigate()` is allowlisted |
| `@typescript-eslint/no-misused-promises` (`checksVoidReturn.attributes`) | an async function handed to a JSX prop typed to return void — the child cannot know it should show pending |
| `SILENT_CATCH_BAN` (`no-restricted-syntax`) | `.catch(() => {})`, `.catch(() => undefined)`, `.catch(() => null)` — these satisfy the promise rules while hiding both the wait and the failure |

**Soft rules the gate cannot check** (review them by hand):

- The pending flag must be RENDERED on the trigger. The gate proves the promise is
  settled, not that anyone sees it.
- `runDetached(label, promise)` (`src/client/lib/runDetached.ts`) is for work no
  user waits on — reconnect, polling, a probe on mount, scroll, best-effort
  cleanup. Using it for a click is the one way around the gate; do not.
- A user action's failure is shown, not only logged: the component's own error
  state, or `setCommandError` in `kannaStateStore` for a WS command.
- A view that loads its data renders a loading state instead of an empty one.
- Do not add a per-component `saving`/`busy` boolean for a new action — use the
  store above. Existing flags that already render correctly were left in place.
- An async prop is typed `() => Promise<void>` all the way down. Retyping it to
  `() => void` to satisfy `no-misused-promises` hides the promise from the one
  component that should render it.

Never silence these rules with `eslint-disable`. See
`adr-20260925-client-pending-action-state`.

# Compaction preservation requirements

When summarizing this conversation, preserve:

- Current task objective and acceptance criteria.
- Explicit user constraints and requested behavior.
- Current implementation status.
- Files created, modified, deleted, or investigated.
- Important functions, symbols, APIs, interfaces, schemas, and data structures.
- Architectural decisions and the reason for each decision.
- Failed approaches that should not be repeated, and why they failed.
- Exact unresolved errors when they are still relevant.
- Test, lint, type-check, build, and validation commands and their latest results.
- Current branch/worktree and relevant git state.
- Remaining work required before the task is complete.
- Assumptions that still require validation.

Do not report a task as complete unless all acceptance criteria and required
validation have been satisfied — and re-run the validation against the current
tree rather than trusting a recorded result, which may predate a compaction.

These are project-root rules on purpose. A nested `CLAUDE.md` or a path-scoped
rule may drop out of context during compaction and only reload when a matching
path is next accessed, so a global invariant must not live only there.

# Subagent delegation

The main agent is always in the loop. `@agent/<name>` in chat input is a
**hint**, not server-side routing; the model delegates by calling
`mcp__kanna__delegate_subagent`. Runs are bounded by a permit pool, a
cycle/depth check (`LOOP_DETECTED` / `DEPTH_EXCEEDED`), and a per-subagent
`maxTurns`.

**`.claude/skills/kanna-subagents/SKILL.md`** holds the detail: roster
injection into the system prompt, the spawn gate (`claudeAuthReady` — the single
definition of it, and why a subagent must never be refused where a main-chat
turn would spawn), keep-alive multi-turn sessions and their permit model, and
background runs plus the `deliverSubagentToMain` re-entry, which /clears main
only when a loop is armed.

# Autonomous loops — `/loop`, `setup_loop`, the oracle, the task list

Long-horizon autonomous loops run notification-driven, with a per-iteration
`/clear` on the main agent. The loop's plan is the chat's **durable,
event-sourced task list** (`src/shared/chat-tasks/**`, on the `chat-tasks` event
log), read and written through the `mcp__kanna__task_*` tools — NOT a markdown
tracking file. It is the ONLY durability contract and survives `/clear`, a
restart, and the transcript tail window. Main context is intentionally ephemeral;
there is no timer-based `schedule_wakeup` (removed — it superseded
`adr-20260603-agent-self-scheduled-wake`). See
`adr-20260918-loop-tasks-replace-tracking-file`.

**`.claude/skills/kanna-loop/SKILL.md`** holds the design: the
orchestrator/worker split and the wake path (with the `<loop-state>` task
snapshot injected by `composeLoopWakePrompt`), `setup_loop` with its `tasks[]`
seed and one-time tracking-file import, the four-case oracle table and the
TERMINAL CHECK over `task_list`, `run_verify` memoization, the `mcp__kanna__task_*`
tools, loop-armed tool blocking, the unified task-sourced Progress panel,
per-subagent `maxTurns`, the three lost-wake recovery passes, and the
disarm/resume tombstone.

Read it before editing the rendered loop prompt — `validateLoopSetup` asserts the
`LOOP_STEP_INVARIANTS` / `LOOP_PARALLEL_STEP_INVARIANTS` substrings, so an edit
that drops one fails validation. The invariant list and the template move
together.

**The markdown tracking tools stay for the NON-loop durable-document use** (see
"A tracking document is durable task state" below); the loop simply no longer
uses them. `claim_tracking_task` / `complete_tracking_task` /
`integrate_tracking_tasks`, `loop-task-queue.ts`, the loop-tracking
registry/sync/io adapters, and the file-based reconcile/skeleton were deleted.

## Parallel loops — a lease belongs to a RUN, never to a clock

`parallelism > 1` uses the same task list; a task's `needs` / `worktree` /
`branch` / `claimId` / `runId` fields are the concurrency control. A task is
claimable only when it is pending (or a stale lease), every id in its `needs` is
completed, and its worktree is not held by a lease whose run is still alive
(`selectClaimableTask`). That one rule is the entire scheduler, and is what makes
"build the user model before authentication" work without one.

**The claim is atomic in one process.** `EventStore.decideChatTaskEvents` runs
the read-decide-append inside the store's per-chat write chain, so two concurrent
`task_claim` calls can never lease the same task — replacing the old
`withFileLock` read-modify-write, which existed only because the markdown tools
had an `await` between reading and writing the file.

**The recovery model is the part that is easy to get catastrophically wrong.** A
worker that FAILS never releases its lease, so the lease is still fresh when its
own failure-wake arrives. An orchestrator that reads "a live lease exists" as "a
worker is coming back" ends its turn — and **nothing ever wakes that chat again**,
because only a run completion produces a wake. A lease TTL cannot rescue this:
TTL expiry generates no wake, so the timer is never read. `delegate_subagent`
therefore takes a `claim_id`, the server records `runId` on the task
(`chat_task_run_bound`), and `task_claim` reclaims every in-progress task whose
run is gone from `store.getSubagentRuns(chatId)`. The 2-minute
`CHAT_TASK_CLAIM_GRACE_MS` covers only a claim that never bound a run. **Do not
reintroduce a TTL as the primary recovery path.**

`MAX_PARALLELISM` is **3**, not 4: `DEFAULT_MAX_PARALLEL` is the whole server's
subagent permit pool, and exhausting it does not fail — it queues silently, so one
loop would stall every other chat with no error anywhere.

**A skipped `/clear` is now deferred, not dropped.** `clearClaudeSessionContext`
only closed the session when `!isSessionInUse`, so a worker finishing during a
sibling's wake-turn made the next orchestrator turn reuse the previous turn's
context — breaking the "the task list is the only state" invariant exactly where
the claim design depends on it. It sets `session.contextClearPending`, which
`spawnClaudeTurn` honours as a respawn trigger beside `loopArmedAtSpawn`.

Integration is a server tool (`task_integrate`), not prompt-level git: the
orchestrator is a fresh context every turn, the worst place for a multi-step
stateful git operation. Each parallel task must name its OWN git worktree; a task
with no worktree, or one naming the loop workdir itself, is refused at claim.

# Tests

`bun run test` MUST pass locally before any push or PR. CI (`.github/workflows/test.yml`)
runs `bun test --conditions production` on every push to `main` and every PR; merges are blocked on failure.
Always use `--conditions production` (or `bun run test`) — Lexical 0.45 dev ESM builds
have a circular-dep TDZ that crashes bare `bun test`. For fast iteration on a single
suite: `bun test --conditions production src/server/<file>.test.ts`.
When a test spawns `git` or other subprocesses, ensure the spawn sets
`stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` so a hung credential prompt
cannot exhaust the test timeout. Also give it an explicit timeout
(`test(name, fn, 30_000)`) — the 5s Bun default is too tight for CI runners.

## Every React root a test mounts must be unmounted (enforced)

happy-dom gives the whole Bun process ONE document, so `scripts/test-preload.ts`
wipes `document.body` after each test. The wipe cannot reach the React root that
owned those nodes: a test that calls `container.remove()` but never
`root.unmount()` leaves a live root — and any portal it opened (Radix
Dialog/Popover/Select, `createPortal`) had `document.body` ITSELF as its
container. When that root next commits, React removes a node the wipe already
took and happy-dom throws `removeChild: The node to be removed is not a child of
this node`, blaming **whichever test is running at that moment** — a different
test, in a different file. File order is the filesystem's, so it reproduces on
CI's ext4 and not on APFS (PR #646: `SharePopover` crashed `CardDrawer` two files
later; the full suite, CI's exact file order, bun 1.3.11, and Linux under Docker
were all green locally).

The same `afterEach` now FAILS the test that leaked, naming the nodes. It reports
only REACT-OWNED leftovers — Lexical's typeahead plugin appends a menu straight
to `document.body` even under `renderToStaticMarkup`, and nothing holds a
reference that could commit against it later.

`renderForLoopCheck` unmounts roots whose callers never called the `cleanup` it
returns, via the teardown registry the preload publishes on
`globalThis.__kannaDomTeardowns`. It cannot own an `afterEach` for that: bun runs
hooks in registration order and the preload registers first, so a helper-owned
hook fires after the sweep has already failed the test.

## Module mocks are banned — `mock.module` outlives its test file (enforced)

`mock.module` substitutes an entry in bun's process-wide module registry, and
nothing restores it when the test file ends — `mock.restore()` covers functions,
not modules, and `bun run test` runs every file in ONE process. Whether the
poison detonates depends on load order. If the real module was already loaded,
the mock only patches its live bindings: exports the factory omits stay real,
and the suite passes. If the mock registers FIRST, the registry holds a
synthetic record with ONLY the factory's keys, and the next file that
static-imports a missing export dies at link time —
`SyntaxError: Export named '…' not found in module` — reported as an
"Unhandled error between tests" against the VICTIM file, which contains no mock
at all. File order is the filesystem's: alphabetical-ish on APFS, hash-order
with a per-VM seed on CI's ext4, so the failure never reproduces locally and
strikes CI at random. Verified on bun 1.3.11 and 1.4.2 alike — a bun upgrade
does not fix it.

Not theoretical: `usePluginContributions.test.tsx` mocked
`./loadPluginContributions` with a factory exporting only the `FromServer`
variant, and whenever ext4 ordered it before `loadPluginContributions.test.ts`
the victim's import of `loadPluginContributions` failed exactly that way. On
2026-09-23 it turned three runs red in one morning — Test on main, the release
PR's Test run, and the Release Please publish job — blocking the v1.58.0 npm
publish (fixed in #1141).

**The remedy is injection, never a better mock.** Pass the dependency as a
parameter defaulting to the production value — #1141's shape:
`load: typeof loadPluginContributionsFromServer = loadPluginContributionsFromServer`
— or thread it through an existing deps object. The test hands its fake
straight in, and no registry state survives the file.

**Enforced by `src/ops/testing/module-mock-guard.test.ts`.** It scans `src/`
and fails any file registering a module mock outside `LEGACY_MODULE_MOCKS` —
the 11 files that predate the rule. The list only shrinks: a second test
asserts every entry still registers one, so converting a file to injection
must delete its entry in the same PR, and a stale entry cannot be reused to
smuggle a new mock in. The legacy files hold today only because each loads its
real module (directly or transitively, via hoisted static imports) before
mocking — the live-bindings case above. That shield is luck, not design: the
`mermaid` and `shiki` mocks among them register synthetic records and would
misbehave in an unlucky order, so burn the list down; never add to it.

**The one sanctioned module patch is `scripts/test-preload.ts`'s `node:fs`
shim.** It runs before ANY test file loads, applies to every file identically,
and spreads the real module so no export goes missing — uniform harness
foundation rather than per-suite state, which is why it cannot create order
dependence. It sits outside the guard's `src/` scope on purpose.

# Wiki

Public docs site lives in `wiki/` (Astro Starlight) and is deployed to
https://kanna-wiki.lowbit.link on every push to `main` that touches `wiki/**`.

`wiki/src/content/docs` is the only place docs are written. Both published copies
are generated from it by jobs in `.github/workflows/wiki-deploy.yml`: the Starlight
site (`build` + `deploy`) and the GitHub Wiki mirror (`github-wiki`, which runs
`bun run export:github-wiki` in `wiki/` and pushes to `cuongtranba/kanna.wiki`).
Never edit the GitHub Wiki; the next sync overwrites it. The sidebar is defined once
in `wiki/src/sidebar.mjs` and feeds both outputs. A new MDX component, or any
construct the converter does not know, needs a rule in
`wiki/scripts/github-wiki/convert.ts`, otherwise the export throws and
`convert.test.ts` fails. The wiki repo has to be bootstrapped once by hand: GitHub
creates `kanna.wiki.git` only when someone saves a first page at
https://github.com/cuongtranba/kanna/wiki, and until then the `github-wiki` job
fails with an error saying so.

The Playwright harness this repo ships lives at `e2e/` (`*.pw.ts` specs,
`e2e/playwright.config.ts`), boots the production single-process server
against a seeded temp `KANNA_HOME`, drives real Chrome, and is run on
demand:

```bash
bun run test:e2e
```

It is deliberately off the CI critical path — never wired into
`.github/workflows/test.yml` — because it needs a real Chrome, not the
happy-dom `bun test` runs against.

Regenerate env-var reference table:

```bash
cd wiki && bun run scripts/extract-env-vars.ts
```

Wiki is isolated from the main repo build — its own `package.json`, own
`node_modules`. `bun run lint` and `bun test` at the repo root do NOT touch
`wiki/`.

# Feature invariants — read the owning skill before editing

Each feature below has load-bearing invariants backed by a measured incident. The
full text lives in the named skill; the one-liners here are the rules most often
broken. Read the skill before changing the code it names.

**`kanna-sessions`** (`.claude/skills/kanna-sessions/SKILL.md`)
- Claude chats run on the Agent SDK only; the PTY driver is gone (`adr-20261008-remove-pty-driver`).
- `/clear` and `/compact` are dispatched by `runBuiltinCommand` AFTER the `isChatBusy` branch; the codex stop in `/clear` is load-bearing.
- Compaction is the CLI's job; Kanna's proactive `/compact` stays off unless `KANNA_PROACTIVE_COMPACT=enabled`. `PostCompact` writes the `compact_summary` the history primer needs.
- A parked `canUseTool` continuation lives in `PendingToolSlots`, never on an `ActiveTurn`. `isChatBusy` and `isSessionInUse` are the single busy/in-use predicates.
- `CLAUDE_TOOLSET` is an exclusive allowlist (`LSP`, `SendMessage` must be on it); the restricted path strips `LSP`.
- Background tasks hold a session warm; a level-sourced session has no deadline. A user send re-arms the guard, never clears it.
- A queued message is released on commit (`onTurnRecorded`), not on dequeue; `buildEnqueueMessageResult` spreads `...message`.
- `TranscriptCache` budgets bytes; never add an unconditional `store.getMessages` to the turn-start path.
- Project-facing spawns build env via `projectProcessEnv`.

**`kanna-cron`** — every refusal goes through `refuseCronCommand`; never drop an unsettled `cron_run_started`; `CronSchedule.second` stays optional.

**`kanna-providers`** — a custom-model override merges per field; `custom` endpoints ride the model id (`<providerId>/<vendorModel>`) and resolve only through `resolveSdkEndpoint`; API keys are write-only; Codex `willRetry: true` means the turn is still live.

**`kanna-mcp`** — user MCP names must never be `kanna`; a stale OAuth bearer is a respawn trigger; the remote `/mcp` OAuth handler is an allowlist and every tool runs through the ws-router seam.

**`kanna-inbox`** — the bus tap is set after `store.initialize()`; `publish` never throws; Kanna never deletes a NATS stream; the agent only drafts inbox replies; webhook secrets live only in `webhooks.json` at 0600 and the route sits before the auth gate; Slack hooks bypass the Inbox on purpose and correlate turns from the bus `transcript.user_prompt` scheduleId, captured synchronously.

**`kanna-genui`** — `parseGenUISpec` is the trust boundary and nothing the model writes executes; `shareableEntries` is a privacy allowlist; share datasets are frozen at mint.

**`kanna-beacon`** — any protocol change updates the Go port and `apps/beacon-win7/testdata/conformance/` in the same PR; Go stays pinned at 1.20; transfer bytes never touch the model or the WebSocket; the `update` frame carries no fields.

**`kanna-features`** — boards: a column's behaviour comes from its `semantic`, and `done` is reached only by the user; tus `chunkSize` must stay under the smallest proxy body cap; package auto-update applies are serialized and `unknown` is not `up_to_date`; plugins are off by default and compile in their own bun process; every client plugin `add*` needs a no-op twin in `plugin-child-entry.adapter.ts`.

**`kanna-telemetry`** — domain code imports `src/server/observability.ts` only; metric names are constants in `EXPORTED_PROM_METRICS`; perf-alert thresholds compare an install against its own past, never against the fleet.
