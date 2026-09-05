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
| `kanna-telemetry` | Adding spans/metrics, and operating the otel-lgtm collector |
| `kanna-react-style` | React + TypeScript conventions for `src/client/**` |
| `kanna-test` | Running tests; the lint, ast-grep, and design gates |
| `kanna-loop` | Autonomous loops: `setup_loop`, the oracle, the tracking file, wake recovery |
| `kanna-subagents` | `delegate_subagent`, the spawn gate, keep-alive and background runs |
| `kanna-pty` | The PTY driver — TUI spawn, transcript follower, `KANNA_PTY_*` |
| `release` | Version bump + npm publish |
| `review-pr` | Security-focused PR review via the GitHub API |
| `github-issue` | Writing bug reports and feature requests detailed enough to implement from |

These files have two consumers — Claude Code auto-triggers on the frontmatter
`description`, and Kanna's own `/` picker parses the same files through
`LocalCatalogService` (`c3-231`). That parser is **line-based**, so a description
must stay on one line: a folded `>-` block silently becomes an empty description
in the picker. `user-invocable: false` hides a skill from the picker while leaving
auto-triggering intact.

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
src/ops/         architecture budget + alerting specs (outside the IO seal)
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

**The one residue is named, not hidden.** `CommandAckResult`
(`shared/protocol.ts`) is `JsonPrimitive | object`: the ack channel carries 51
concrete result types with no common supertype, and relating result to command
is issue #899 (`untyped-command-results`), not something a type can fix here.

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
  (`deps-bundles`, `ws-router-dispatch-arms`, `untyped-command-results`, …).
  Growing fails; **shrinking also fails**, because a pin left above the real
  count is a pin the population can creep back up to. Each entry carries the
  `issue` it regresses and a `rationale`, so a breach message says which filed
  issue this PR just made worse rather than printing a bare number.

**ESLint owns the complexity measurement; the budget owns the direction.**
`eslint.config.js` sets four production ceilings — `complexity` 138,
`max-params` 12, `max-depth` 7, `max-nested-callbacks` 4 — at today's maxima, so
they are unbreached but hard. `ESLINT_LIMIT_PINS` must **equal** each configured
value: raising the ceiling fails `check:arch` as `limit_raised`, and lowering it
without lowering the pin fails as `limit_slack`. The adapter reads the real
`eslint.config.js` rather than a transcription, so pin and enforced value cannot
agree on paper while disagreeing in fact. A pin whose rule ESLint no longer
configures fails as `limit_unconfigured` rather than passing vacuously.

The peaks are the audit's own findings, which is why these are defect counts and
not style knobs: `complexity` 138 is `handleCommand` in `ws-router.ts` (`runClaudeSession`
dropped from 141 → 132 after the `ClaudeSessionState` class refactor, #923),
`max-depth` 7 is `runClaudeSession`'s `for await` loop, and `max-params` 12 is `deriveChatSnapshot`.

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

# Tool Callback Feature Flag (KANNA_MCP_TOOL_CALLBACKS)

Setting `KANNA_MCP_TOOL_CALLBACKS=1` routes `AskUserQuestion` and
`ExitPlanMode` through the durable approval protocol in
`src/server/tool-callback.ts`. Pending requests survive server restart
(resolved as `session_closed` fail-closed on boot) and are replayed to the
client on reconnect as `pending_tool_request` transcript entries. Default is
off; the SDK driver uses the legacy `canUseTool` → `onToolRequest` path.

**PTY exception (issue #215):** under `KANNA_CLAUDE_DRIVER=pty` the
`ask_user_question` / `exit_plan_mode` shims are **always registered**
regardless of this flag — the PTY driver passes
`forceInteractiveToolCallbacks: true` to `buildKannaMcpTools` because
PTY has no `canUseTool` hook (the durable approval protocol is the only
host path). The PTY CLI args also include
`--disallowedTools AskUserQuestion ExitPlanMode` so the model cannot
pick the native built-ins (which the CLI auto-rejects with
`is_error: "Answer questions?"`, mis-read as a user cancel). The flag
still **exclusively** gates the 8 built-in shims
(`read/glob/grep/bash/edit/write/webfetch/websearch`) and the SDK
driver's `canUseTool` routing — those are never force-enabled under PTY.

## Pending-tool lifecycle (legacy `canUseTool` path — PendingToolSlots)

On the legacy path the parked request is nothing but an in-memory promise:
the parked `resolve` IS the SDK worker's `canUseTool` continuation. Drop it
and that worker blocks forever, `respondTool` throws `"No pending tool
request"`, and the chat is wedged with no way back — under the SDK driver
`interrupt()` is in-band, so the session survives and nothing else frees it.

**The parked continuation lives in `PendingToolSlots`
(`src/server/pending-tool-slot.ts`), keyed by chatId and INDEPENDENT of any
`ActiveTurn`** (adr-20260807-pending-tool-slot). There is no
`ActiveTurn.pendingTool` field and no ghost turn: when the SDK self-resumes
after a background-task notification and calls `canUseTool` outside any
Kanna turn, the request simply parks in the slot. The predecessor design
fabricated a ghost `ActiveTurn` (`rebuiltFromSession`) to hold the resolve;
every consumer of `activeTurns` then had to special-case it, and the one
that didn't leaked the ghost forever — chat stuck "running", sends queued
with no drain, `selfWakeActive` wedged, idle reaper blocked (session
04fb43c9). Do NOT reintroduce a turn-attached pending tool.

Slot transitions: `park` (dedup — an occupied slot is discarded first),
`take`/`takeAny` (caller settles, used by `respondTool`/`cancelChat` so the
transcript append precedes the worker resuming), `discard` (settle-now, used
at terminal results and session death). Settling uses `discardedToolResult`
→ `{discarded: true}`, and `buildCanUseTool` short-circuits that to
`behavior: "deny"` — without the short-circuit its legacy branch maps *any*
result to `behavior: "allow"`, so the SDK would actually execute
`AskUserQuestion` with empty answers and overwrite the "Discarded" marker.

Settle sites: `cancelChat` (FIRST, turn-independent — one Stop frees a
question parked mid-turn or mid-self-wake), the runner's real-turn result
finalize, the self-wake disarm branch (which also drains the queued-message
queue), and the runner's `finally` (session death). The reaper
(`isClaudeSessionIdle`) and budget enforcer never close a session whose chat
has a parked slot — the worker is blocked inside `canUseTool`, so
`lastUsedAt` stales while the user reads the question.

**Busy derivation is single-sourced:** `isChatBusy`
(`claude-session-state-queries.ts`) = live turn ∨ booting turn ∨ parked
slot ∨ streaming self-wake. The send gate and `maybeStartNextQueuedMessage`
both consume it; never combine the underlying maps ad-hoc.

Optional `KANNA_SERVER_SECRET` env var stabilises HMAC tool-request ids
across the process lifetime. Cross-restart idempotency does not matter
because `recoverOnStartup()` fail-closes all pending records on boot.

Periodic `tickTimeouts` driver fires every 5s; default request timeout is
600s. Pending requests time out as `{kind:"deny", reason:"timeout"}`.

# Claude driver flag (`KANNA_CLAUDE_DRIVER`)

`sdk` (the default) runs the Claude Agent SDK and bills at API rates. `pty`
launches the `claude` CLI **interactively** under a Bun.Terminal pseudo-terminal,
tails the on-disk transcript JSONL as its sole event source, and preserves
Pro/Max subscription billing. PTY is macOS/Linux only and OAuth-only —
`buildPtyEnv` unconditionally strips `ANTHROPIC_API_KEY`, and the token comes
from the OAuth pool via `CLAUDE_CODE_OAUTH_TOKEN`.

**`.claude/skills/kanna-pty/SKILL.md`** holds the detail: the encoded-cwd path,
the trust dialog, the TUI-ready gates on both first and follow-up turns, the
50 ms tail-poll transcript follower (and why there is no `fs.watch`), turn-end
detection under CLI ≥ 2.1.x, the spawn smoke test, `setPermissionMode` /
`setModel` / `interrupt`, OAuth-pool rotation, and every `KANNA_PTY_*` env var.

# Builtin slash commands — `/clear` and `/compact [instructions]`

Two commands Kanna implements itself rather than forwarding as prompt text.
`src/shared/builtin-commands.ts` is the single source for both the parser and
the picker catalog (`BUILTIN_SLASH_COMMANDS`, `scope: "builtin"`); a colocated
drift guard asserts every catalog entry parses, so the picker can never
advertise a command dispatch does not handle. **A builtin must be the whole
message** — `/clear now` does not match, because discarding what the user typed
is worse than treating the line as a prompt.

`runBuiltinCommand` (`claude-send-command.ts`) is the one dispatch site, called
from `sendCommand` **after** the `isChatBusy` branch and from
`dequeueAndStartQueuedMessage` (non-steered only). That placement is what makes
a `/clear` typed mid-turn queue like any other message; do not hoist it above
the busy check.

- **`/clear`** starts no turn. `clearChatContext`
  (`claude-context-commands.ts`) nulls every provider's token, applies the
  claude suppress-persist + idle-session teardown, **stops the codex process**,
  and appends `context_cleared`. The codex stop is load-bearing:
  `CodexAppServerManager.startSession` reuses a live session on a cwd match and
  never consults the session token, so a token wipe alone is a no-op on the next
  turn. `clearClaudeSessionContext` lives here too (moved from
  `claude-loop-commands.ts`, re-exported) so the loop `/clear` and the user
  `/clear` cannot drift.
- **`/compact`** is a turn everywhere. claude + openrouter get the CLI command
  verbatim (`appendUserPrompt: false`). Codex's app-server exposes **no**
  compaction request, so Kanna runs the summarization itself and
  `claude-turn-runner.ts` reshapes the reply into `compact_boundary` **then**
  `compact_summary`. That order is load-bearing — the history primer resumes at
  the last boundary, so summary-first would discard the summary. Error, cancel,
  or empty prose commits nothing.

## `CompactionTurnKind` — one field, two questions

`ActiveTurn.compactionTurn` is `"proactive" | "user" | "codex_summary"` (it
replaced the boolean `proactiveCompactInjection`). Two predicates read it, and
they are deliberately different:

- `isCliCompactTurn` — gates the PTY `compact_boundary` finalize
  (`adr-20260608-pty-compact-boundary-dequeue-finalize`). Covers `proactive` AND
  `user`: both reach the CLI verbatim, so both go quiet the same way.
- `isProactiveCompactTurn` — gates the `compactFailureCount` circuit breaker and
  the `message.dequeue` refusal. `proactive` only. Both exist to bound Kanna's
  **own** automatic injection; a user-typed `/compact` owns no queued message
  and must not consume that budget.

## History primer is scoped to the last context reset

`buildHistoryPrimer` (`history-primer.ts`) starts at the most recent
`context_cleared` / `compact_boundary`, counts `compact_summary` as assistant
content, and hoists a summary sitting on the older side of its own boundary
(emission order is not ours to control). Without this, `shouldInjectPrimer`
returning true on a null token means a cleared chat re-sends up to
`PRIMER_MAX_CHARS` (60k) of the conversation it just dropped — which silently
defeated the loop `/clear` path (`setup_loop`, `deliverSubagentToMain`,
`disarmFailingLoop`) too, despite that design resting on main being
stateless-in-context. `shouldInjectPrimer` itself is unchanged: "token null ⇒
prime" was always right; the bug was *what* got primed.

The picker merges the builtins in `localCommandsForCwd`, not in
`LocalCatalogService.list` (whose contract stays the disk catalog). The catalog
is no longer narrowed by provider — see **Local skills on every provider** below.
A project-authored `.claude/commands/clear.md` is dropped from the listing
because dispatch intercepts that name first; rename it.

See `adr-20260811-builtin-clear-compact-commands`.

# Local skills on every provider — `/name` expansion + the Codex roster

The claude CLI resolves `/name` against `.claude/skills` + `.claude/commands`
itself, so `claude` and `openrouter` (same SDK, `settingSources: ["user",
"project", "local"]`) have always worked. Codex received the literal line and
answered it as prose, and `commandsForProvider` hid every non-builtin from its
picker to stop that — which left the whole local skill catalog unreachable
there. Kanna now expands the command itself, on two fronts.

**`providerExpandsSlashCommands` (`provider-model-types.ts`) is the gate, and
its DEFAULT direction is load-bearing.** It lists the providers whose harness
does the expansion (claude, openrouter); everything else gets Kanna's. A
provider added later and forgotten by the list therefore gets WORKING slash
commands, where a default of "the harness handles it" would silently give it
none. Its membership equals `providerUsesSdkSession` today and the two are
pinned against each other by a test — but they answer different questions (how a
prompt is DELIVERED vs what the prompt should BE), so do not collapse them.

**User-invoked** — `expandSlashCommand` (`skill-invocation.ts`) resolves the
name through `LocalCatalogService.resolve`, reads the file with
`readCatalogFileBody`, and `buildSlashExpansion` (`shared/slash-expansion.ts`)
substitutes `$ARGUMENTS` / `$1..$9`. A **command** expands to its substituted
body verbatim (a command file *is* a prompt); a **skill** gets a header naming
it, its directory, and the arguments, because `SKILL.md` is a document rather
than a request. Dispatched from `claude-send-command.ts` at the two sites that
already dispatch builtins — after `parseBuiltinCommand` (so `/clear` is never
shadowed), after the `isChatBusy` branch (so a `/skill` typed mid-turn queues),
and never for a steered message.

**`StartTurnForChatArgs.promptOverride` is what the provider runs; `content`
stays the line the user typed.** So the transcript bubble and the generated
title read `/deploy staging` rather than an 8 KB skill body. `user_prompt`
carries `expandedCommand` and `UserMessage` renders it as one muted line —
without it "the skill ran" and "your text was sent verbatim" are
indistinguishable, and they behave completely differently.

**Model-invoked (Codex)** — `renderSkillRosterBlock` (`kanna-system-prompt.ts`)
lists each skill's name, description and absolute `SKILL.md` path into
`buildCodexDeveloperInstructions`, capped at `KANNA_SKILL_ROSTER_LIMIT` (60) and
truncating long descriptions. **Reading the named file IS the invocation:**
Codex's app-server protocol has no way to declare a tool — `ThreadStartParams`
carries no `mcpServers`, `TurnStartParams` no `tools`, and an unknown dynamic
tool call is answered `Unsupported dynamic tool call` — so `developerInstructions`
is the only injection point there. It works because the thread runs
`sandbox: "danger-full-access"`, which makes a personal or plugin skill outside
the project cwd reachable by absolute path. The roster is the ONE consumer of
`KannaSystemPromptOptions.skills`; the Claude suffix ignores it, since the CLI
loads a skill on demand and this only inlines a pointer.

**Applied at `thread/start`, so a skill authored mid-chat reaches the model at
the next session start** (`/clear`, restart, idle reap) — `startSession` reuses a
live session on a cwd match.

**`LocalCatalogService` has two readers over ONE scan.** `resolve` is restricted
to user-invocable entries so an invocation and the picker cannot disagree about
which names exist; `skills` deliberately INCLUDES `user-invocable: false` ones,
because that flag hides a skill from the picker while leaving auto-triggering
intact. Both read the cached row — neither rescans.

**`` !`cmd` `` and `@path` are NOT executed.** They survive verbatim and the
expansion adds one line telling the model to run/read them with its own tools.
Executing a shell command on the send path would put arbitrary execution ahead
of the turn meant to approve it.

**Every failure degrades to "send what the user typed."** An unresolvable name
may be a path, or a command the provider itself knows; an unreadable `.claude`
directory costs a skill, while failing the send costs the turn.

# Mermaid Validation Gate (KANNA_MERMAID_GUARD)

Kanna renders mermaid inline, so a syntax error reaches the user as a broken
diagram. **The model's diagrams are validated against mermaid's real parser
before they can stand.** Two layers, deliberately covering each other:

- **`mcp__kanna__validate_mermaid`** (in-turn, proactive). The model calls it
  with a diagram source and gets back `VALID`, or an `isError` result carrying
  the offending line, mermaid's caret excerpt, and a hint. It self-corrects in
  the same turn — no extra turn, and the user never sees the bad version.
  Registered whenever a `chatId` is present (subagents included); one `tool()`
  call covers both drivers via `kanna-mcp-http.ts`.
- **End-of-turn guard** (`src/server/mermaid-guard.ts`, reactive backstop). At
  the runner's success finalize (`claude-session-runner.ts`, after
  `recordTurnFinished`, **before** `maybeStartNextQueuedMessage` so the drain
  picks up what it enqueues) the server re-reads the turn's `assistant_text`,
  extracts ```mermaid fences and validates them. On a real failure it enqueues
  one correction prompt via `enqueueMessage` with a synthetic
  `autoContinue.scheduleId` — the `wakeBackgroundTaskSession` shape, NOT
  `deliverSubagentToMain`'s: **no `/clear`**, because the model needs the
  diagram still in context to fix it.

**The guard's bounds are load-bearing, not defensive.** It fires only when the
reader would actually see an error — a diagram `repairMermaidSource` saves
renders with the "Corrected …" banner, so spending a turn on it buys nothing.
It asks about a given diagram **exactly once** per chat (bounded memory, 32
sources), because a model that cannot fix its own diagram would otherwise be
asked every turn forever. It stands aside when a user message is queued, skips
errored/cancelled turns, and swallows its own failures — a diagram is cosmetic,
a dead turn is not. `KANNA_MERMAID_GUARD=disabled` turns the backstop off; the
tool stays.

**Server-side mermaid, without a new dependency.**
`src/server/mermaid-parse.adapter.ts` is the only place mermaid loads on the
server. mermaid is a browser library, so the adapter installs a ~20-line
measured-minimum DOM surface **only around `await import("mermaid")`** and
restores it in a `finally` — nothing downstream can sniff `window` and take a
browser code path. `installDomShim` stands down entirely when a real `document`
exists (the happy-dom the test preload registers process-wide). ~9 ms per
parse, every diagram type. Rejected: happy-dom as a prod dep (it swaps
`fetch`/`FormData`/`Blob` — see `scripts/test-preload.ts` undoing exactly that)
and a child process (~200 ms spawn for a 9 ms parse). The adapter's suite
includes a **subprocess test with no happy-dom** — the only thing that proves
the gate works where it runs; without it a broken shim would pass CI and
silently disable validation.

**Layout.** The pure pieces live in `src/shared/`: `mermaid-fences.ts` (the ONE
definition of a fence — the Lexical `MERMAID_FENCE` transformer consumes it, so
the editor and the guard can never disagree about where a diagram ends),
`mermaidError.ts`, `mermaid-hints.ts` (error signature → advice; **advice only,
never a rewrite**), `mermaid-validate.ts`, `mermaid-report.ts` (the wording both
surfaces speak), `mermaidRepair.ts`. `mermaid-validation.ts` holds the contract,
including `MermaidParsePort` — no domain module imports mermaid.

**Prompt drift is a build failure.** `KANNA_SYSTEM_PROMPT_BASE` carries the
same knowledge as the repair table, and the two drifted for four releases (the
prompt named `()` and `[]{}` while the failure users hit was a `/`-leading path
label). `src/shared/mermaid-prompt-drift.test.ts` asserts the prompt mentions
every `LINK_RULES_FOR_PARITY` rule, every character that forces a quoted label,
and the tool name. It gates COVERAGE, not prose — reword freely, but a rule the
repair knows must be one the prompt warns about.

**The grammar fact this all rests on** (mermaid 11.15.0,
`flowDiagram-I6XJVG4X.mjs` rule 116): the only plain-text run inside the `text`
lexer state is `/^(?:[^\[\]\(\)\{\}\|\"]+)/`, so an unquoted label is readable
iff it holds none of `[ ] ( ) { } | "`. Rule 95 (`[/`) longest-match-beats plain
`[` and pushes `trapText`, which closes only on `/]` or `\]` — that is why
`Current[/opt/app/current symlink]` dies. Rule 24 (`"`) is present in every
state, so quoting is the universal escape; a literal `"` is written `#quot;`.

# `/cron` Self-Repair (KANNA_CRON_REPAIR)

`/cron` always intercepts and never starts a turn, so a rejected line used to be
terminal Kanna state. Chat `39b0d210` is what that cost: three
`cron_command_error` entries in 34 seconds, no suggestion on any of them, then
the user gave up. **The line they typed was recorded nowhere** — no
`user_prompt` is appended on this path — so neither the reader nor the model
could see what failed. Same two-layer shape as the mermaid gate, with the
parser as the deterministic layer.

- **`CronParseError.input` is required.** `parseCronCommand` stamps it once on
  the way out, over an internal `Outcome` type whose error omits it — so a
  failure path cannot record a defect without the line that caused it, and a
  newly added one will not compile. The error card renders it.
- **`validate_cron` / `arm_cron`** (`kanna-mcp.ts`) mirror `validate_mermaid`.
  Both answer from one `previewCronCommand` (`cron/preview.ts`) — the humanized
  schedule plus the next 3 real fire times, or the refusal — so the two tools
  can never disagree about a line, and both run the parser the send pipeline
  uses. `validate_cron` gates on a chat alone; **`arm_cron` also needs the
  injected `armCron`, supplied for main chats only** (`depth === 0`, like
  `setup_loop`) — a subagent's chat is ephemeral and must not leave recurring
  work behind. `AgentCoordinator.armCron` REFUSES a non-armable line instead of
  dispatching it; dispatching would card the failure and re-offer it to the
  model, so a model answering its own repair prompt would loop.
- **`createCronRepair`** (`cron/repair.ts`) is the escalation, shaped like
  `createMermaidGuard`. **Its bounds are load-bearing:** it stands down when the
  parser produced a `suggestion` (the card already offers a free fix — the
  analog of mermaid standing down on a repairable diagram); it covers
  arm-shaped `part`s only, never management-subcommand typos; it asks about a
  given line **once per chat** (32-entry bounded memory), because a model that
  cannot repair a line must not be asked every time the user retypes it; and it
  swallows its own failures. Unlike the mermaid guard it also **drains the
  queue** — `/cron` starts no turn, so nothing else ever would.
- **One refusal path.** `refuseCronCommand` (`cron/commands.ts`) appends the
  card and offers the line together, so a new refusal cannot record one without
  the other. A schedule that parses but never fires (Feb 30) escalates too, on
  a reconstructed canonical line.
- **Deterministic coverage widened** so escalation stays rare: `parseCronFields`
  pads a 2–4 field cron with wildcards (`0 3` → `0 3 * * *`), but only when the
  padded form actually parses — English like `9am every day` yields nothing and
  goes to the model.

`KANNA_CRON_REPAIR=disabled` turns the escalation off; the tools stay. See
`adr-20260816-cron-llm-repair`.

# `/cron` Arm Confirmation (KANNA_CRON_CONFIRM)

After a user types a `/cron` command that arms successfully, `createCronConfirm`
escalates the result to a model review turn so the user can confirm, adjust, or
disarm the job before it runs unchecked. This mirrors `createCronRepair`'s shape
exactly — same four bounds:

| `createCronRepair` bound | Confirm equivalent |
| --- | --- |
| Stands down when a suggestion exists | Arm-shaped failures only (this path never sees failures) |
| One ask per line | One confirmation per `jobId` — a re-arm is a new job |
| Stands aside for queued user message | Identical |
| Never throws into the send path | Identical |

**Only on the typed path.** `createCronConfirm` is wired into `buildCronCommandDeps`
but `armCron` (the `arm_cron` MCP tool) overrides `cronConfirm: undefined` — the
model path already instructs the model to call `AskUserQuestion` after arming
(see `arm_cron` post-arm review below), so double-confirming is worse than not
confirming.

The escalation enqueues a `formatCronConfirmRequest` prompt with
`autoContinue: { scheduleId: 'cron-confirm-<jobId>' }` and drains the queue
(`/cron` starts no turn, so nothing else would ever pick it up — same as the
repair path).

`KANNA_CRON_CONFIRM=disabled` turns the escalation off. See
`adr-20260818-cron-arm-confirmation`.

# `arm_cron` post-arm review

After a successful `arm_cron` call the tool result carries:

1. `Armed as <jobId>.` — the durable id the model can pass to `/cron remove`
   if the user wants to disarm.
2. `formatCronArmSummary` — the same structured summary the `cron_armed` card
   renders: schedule (human + raw), mode + consequence, next 3 fires, model, cwd.
3. An explicit instruction to present the config and confirm via
   `AskUserQuestion` — options: Confirm / Change schedule / Change mode /
   Change instruction / Disarm.

**This is a prompt contract, not an env-var gate.** The arming happens before
the review instruction is returned, so a timed-out or unanswered question
leaves the job armed — the correct direction to fail. The instruction covers
the change path: arm a corrected line, then `/cron remove <old-jobId>`.

`armCron` now returns `Promise<{ jobId: string }>` instead of `void`. Every
call site that forwards it (`claude-session-spawner.ts`, `claude-session-start.ts`,
`claude-pty/driver.ts`, `agent-coordinator-types.ts`) and every interface that
owns a `runCronCommand` slot (`claude-send-command.ts`, `ws-router-agent-ctrl.ts`)
carry the updated return type. See `adr-20260818-cron-arm-confirm-tool-result`.

**A multiline `/cron` message is its own `part` (`"multiline"`), not
`"subcommand"`.** Chat `061b8856` reproduced 39b0d210's dead end even with
`input` recorded: the user's message wrapped onto a second line, the guard in
`parseCronCommand` rejected it with `part: "subcommand"` and no `suggestion`,
and `REPAIRABLE_PARTS` excluded `"subcommand"` — so `createCronRepair.offer`
returned before ever asking the model, twice, with nothing else happening.
The exclusion was meant for genuine management-subcommand typos
(`/cron list extra`, `/cron remove` with no id), which always carry a
mechanical `suggestion` and so never actually reach that check — the
multiline guard was the only live path hitting it, and it isn't a subcommand
typo at all: a wrapped or multi-sentence instruction is still arm-shaped,
just with no mechanical way to collapse it to one line. `"multiline"` is
listed in `REPAIRABLE_PARTS` so it escalates to the model like any other
unfixable arm.

# `/cron` sub-minute schedules

Seconds are **node-cron's own shape, not Kanna's invention**: `CronTime` reads a
6-field expression as seconds-first, so `parseCronFields` accepts 5 **or** 6
tokens (prepending a `second` spec, 0–59) and hands the expression through
untouched. `every Ns` joins `m`/`h` in the interval regex. **There is no minimum
cadence and no setting for one** — a cadence is chosen in the `/cron` line and
nowhere else; `every 1s` arms.

- **`CronSchedule.second` is OPTIONAL, deliberately.** `cron_armed` persists the
  whole schedule object on the auto-continue log, so every job armed before this
  replays without the field; absent reads as the 5-field "at second 0". Making
  it required would strand them.
- **The model's vocabulary is part of the feature.** The refusal users hit
  ("cron cannot run more often than every 1 minute") came from
  `repair-report.ts`'s grammar prose and the `validate_cron` tool description,
  not from the engine. Both now name the seconds forms; a parser change without
  them leaves the model refusing what the parser accepts.
- **Consecutive skips collapse into one counted record** (`cron/skip-coalescer.ts`),
  because skip-and-record assumed ticks are rare relative to run duration — true
  at minute cadence, false at `every 5s` against a 20 s task (3 cards per cycle,
  ~2 000/hour, into a JSONL log that is never compacted). It is a per-job
  **leading-edge** throttle: the first skip after a quiet stretch writes
  immediately — a `@daily` job skipped at 09:00 must say so at 09:00, and a
  window can only be noticed by a LATER tick, so holding it would delay that
  notice by a day — then skips inside the window are counted and the folded count
  is written by the first tick or run past it. Both fire paths `flushPending`
  before starting a run so the tail lands next to the run it waited on;
  `emitCronEvent` `forget`s a job's streak on arm/pause/disarm.
- **The count is tallied at the tick, never derived at read time.** Deriving it
  means walking `CronTime.getNextDateFrom` across the streak — MEASURED at ~42 µs
  per call — inside `deriveCronJobs`, which runs on every chat broadcast. It
  rides the existing `missedCount`, whose meaning widens from server-offline-only
  to "how many fires this row represents".
- `skipCoalescer` is **required** on `CronFireDeps` (optional on
  `CronCommandDeps`, where it only cleans up): a missing wiring must be a compile
  error, not a silent return to one write per tick.

See `adr-20260816-cron-seconds`.

# Kanna-MCP Built-in Shims

When `KANNA_MCP_TOOL_CALLBACKS=1`, kanna-mcp registers 8 additional tools
that mirror Claude's built-ins: `mcp__kanna__{read, glob, grep, bash, edit,
write, webfetch, websearch}`. They route through the durable approval
protocol with the same path-deny rules as the bash tool from P1 (readPathDeny
for `read`/`glob`/`grep`, writePathDeny for `edit`/`write`).

These shims are inert until the PTY driver applies `--tools "mcp__kanna__*"`
(P3b — landing in a follow-up PR). With the SDK driver (default), the model
still uses its native built-ins and these shims sit unused.

`websearch` is a stub that always returns `isError: true` — real web search
needs an external API integration which is out of scope for P3a.

# Custom MCP Servers

Users register MCP servers via Settings → "MCP servers". Entries persist
in `settings.json` under `customMcpServers` (file mode 0600) and are
merged into both Claude drivers at chat spawn time:

- **SDK driver** (`agent.ts`): `buildUserMcpServers` maps each enabled
  entry to the SDK's per-transport config and merges it into the
  `mcpServers` map passed to `query()` alongside `mcp__kanna__*`.
- **PTY driver** (`kanna-mcp-http.ts:buildMcpConfigJson` +
  `claude-pty/driver.ts`): entries serialize into the same
  `mcp-config.json` the driver hands to `--strict-mcp-config`. Kanna
  settings remain the single source of truth; `~/.claude.json` stays
  ignored.

User MCP tool calls auto-allow (`canUseTool` already returns
`{ behavior: "allow" }` for any tool that isn't `AskUserQuestion` /
`ExitPlanMode`, which includes every `mcp__<name>__*` whose `<name>`
isn't `kanna`). Trust model: if the user installed it, they trust it.

Supported transports: `stdio`, `http`, `sse`, `ws`. Reserved name:
`kanna`. Names match `^[a-zA-Z][a-zA-Z0-9_-]{0,31}$` and form the tool
prefix `mcp__<name>__<tool>`.

**Connect-test:** on create/update, `ws-router.ts` fires a fire-and-
forget `validateMcpServer` (`src/server/mcp-validator.ts`, 10s timeout,
list-tools probe) and persists `lastTest` on the entry. The UI shows a
per-row status pill plus a manual "Test" button that drives the
explicit `settings.testMcpServer` RPC.

**Boundary rule:** user MCP server names MUST NOT equal
`KANNA_MCP_SERVER_NAME`. Enforced by both `validateMcpShape`
(`app-settings.ts`) and `buildUserMcpServers` / `buildMcpConfigJson`
filters (belt-and-suspenders).

## Custom MCP Servers → OAuth

OAuth 2.1 (PKCE + DCR + rotating refresh) is supported for `http` and `sse`
transports only. The flow is explicit discovery rather than SDK auto-discovery:
the SDK's `auth.js` `discovery()` helper follows RFC8414
(`<issuer>/.well-known/oauth-authorization-server`) but some servers (e.g.
Anthropic design MCP) serve the AS metadata only at the OpenID path
(`<issuer>/.well-known/openid-configuration`), returning the claude.ai SPA
HTML at the RFC8414 path — breaking auto-discovery. `mcp-oauth.adapter.ts`
probes the OpenID path first, then falls back to RFC8414.

**Two-step paste UX.** Kanna has no redirect server, so after the AS redirects
the browser to `http://localhost:3334/callback?code=…`, the user copies that
URL from the browser address bar and pastes it into the Settings UI. The
`completeMcpOAuth` WS command exchanges the code via PKCE and stores tokens.

**Token lifecycle.** `ensureFreshMcpToken` (called at chat spawn) pre-fetches a
fresh access token if the current one is within 60 s of expiry. Rotating
refresh tokens are persisted back via `persistOAuthState`. The access-token TTL
is determined by the AS (Anthropic design MCP issues 8 h tokens) — but refresh
extends the session indefinitely, so the 8 h is not a re-auth interval.
`completeMcpOAuth` persists the resolved AS `metadata` (`token_endpoint`) onto
`McpOAuthState.metadata`; `ensureFreshMcpToken` uses it
(`metadataByIssuer?.[issuer] ?? oauth.metadata`) so `refreshAuthorization` hits
the cached `token_endpoint` directly and never re-discovers from `issuer` (which
may be a non-resolvable resource URL like `https://claude.ai/v1/design/mcp` —
re-discovery there returns SPA HTML and was the cause of "token refresh failed"
forcing an 8 h re-auth; see adr-20260630-mcp-oauth-refresh-metadata). Entries
authenticated before this fix lack persisted metadata and must re-auth once.

**Storage.** OAuth state (`clientByIssuer`, `tokens`, `issuer`, `metadata`, `flow`) is
stored inside the server entry in `settings.json` (file mode 0600). The
`flow` field is present only mid-flow and cleared on complete or cancel.
DCR results are keyed by AS issuer to avoid re-registering if the same AS
serves multiple servers.

**Bearer injection.** At spawn, `AgentCoordinator.buildOAuthBearers` iterates
enabled network servers, calls `ensureFreshMcpToken` (refresh if needed, then
return the access token), and builds a `ReadonlyMap<serverId, token>`. Both
`buildUserMcpServers` (SDK driver) and `buildMcpConfigJson` (PTY driver) merge
`Authorization: Bearer <token>` into the transport headers for that server.
`validateMcpServer` also accepts an optional `bearer` for the manual "Test"
action on OAuth servers.

# Configurable Model Catalog (customModels)

Claude + Codex models are user-configurable from Settings → "Models" instead
of being hardcoded. Entries persist in `settings.json` under `customModels`
(seeded on first load from the built-in `PROVIDERS` list) and merge into the
effective catalog at read time.

- **Single source of truth.** `PROVIDERS` in `src/shared/types.ts` is the only
  built-in catalog. `src/server/provider-catalog.ts` `SERVER_PROVIDERS` is
  `[...PROVIDERS]` — the former duplicate `HARD_CODED_CODEX_MODELS` was
  removed (it drifted).
- **Merge.** `mergeCustomModels(base, customModels)` (pure, in `types.ts`)
  folds each `CustomModelEntry` over its provider's model list: same `id`
  **overrides** the built-in in place, a new `id` is **appended**. `base`
  built-ins always remain as a fallback, so the catalog is never empty.
  **An override MERGES per field, it does not replace the object.** It used to
  replace, and since the Settings form collects only id/label/efforts, a
  hand-added entry for an id that already ships silently stripped every
  capability it had no way to declare. A user's hand-added `claude-opus-5`
  (createdAt 2026-07-25) shadowed the built-in's
  `contextWindowOptions: ["200k","1m"]`; `getClaudeContextWindowOptions` then
  returned `[]`, `ChatPreferenceControls` hid the 1M toggle (`length > 1`), and
  `normalizeClaudeContextWindow` pinned every turn to 200k — visible only as a
  `runConfig.model` with no `[1m]` suffix, and as auto-compaction at ~168k on a
  chat the user believed was running on 1M. There is no "explicitly none" to
  preserve: `applyCustomModelPatch` collapses a cleared field to `undefined`,
  indistinguishable from never-set.
- **A downgraded context window is logged, never silent.**
  `normalizeClaudeModelOptions` warns when the requested window is not the
  resolved one. The window is a 5x difference in usable context and nothing else
  in the system reports the substitution.
- **The Models editor always records the context-window choice explicitly.**
  `ModelsSection` pre-fills its "Offer the 1M context window" checkbox from
  `effectiveContextWindowOptions` — the entry's own options, else the built-in's,
  the same fallback the merge applies — and writes `["200k","1m"]` or `["200k"]`
  on save. Pre-filling from the DECLARED options instead would tick the box off
  for an entry that was inheriting, and the save would write the inheritance
  away.
- **Seed + revert-to-default.** `normalizeCustomModels` (`app-settings.ts`)
  seeds `customModels` from built-ins (deterministic `createdAt/updatedAt = 0`)
  when the persisted value is absent, making every built-in an editable copy in
  the UI. Deleting a seeded copy removes the override, so the identical
  built-in shows through again (revert-to-default); deleting a purely-custom
  id removes it entirely.
- **CRUD.** `AppSettingsPatch.customModels` carries `create | update | delete`,
  handled by the settings reducer (mirrors `customMcpServers`), validated by
  `validateCustomModelShape` (id regex, non-empty label, provider ∈
  {claude,codex}, dedupe per provider). Rides the existing
  `handleWriteAppSettings` RPC — no new endpoint.
- **Transport.** `deriveChatSnapshot` (`read-models.ts`) emits
  `availableProviders: mergeCustomModels([...SERVER_PROVIDERS], customModels)`
  (customModels threaded from `AppSettingsManager` at the `ws-router.ts` call
  site) — the per-chat snapshot is the single server→client catalog transport.
  `normalizeServerModel(provider, model, customModels)` accepts custom ids at
  turn time. Client: `selectCustomModels` selector (stable `EMPTY` ref) +
  `ModelsSection.tsx` CRUD UI; the Settings-page default-model pickers derive
  `mergeCustomModels([...PROVIDERS], customModels)`. Both `mergeAppSettingsPatch`
  copies (client store + `ws-router` fallback) pin `customModels` so the CRUD
  patch shape never leaks over the array.
- **Scope.** OpenRouter untouched (already dynamic via API). Providers
  themselves are not add/removable — models only.

# Codex Failure Classification (`codexErrorInfo` + `willRetry`)

A failed Codex turn carries a machine-readable reason, not just prose. Kanna
reads both fields the app-server sends and stops guessing from error strings.

**Regenerate the protocol truth, never infer it.** `codex app-server
generate-ts --out <dir>` emits the authoritative bindings; `v2/TurnError.ts`
and `v2/CodexErrorInfo.ts` are the source for
`src/shared/codex-error-classification.ts`. The app-server exposes these in
**camelCase** (`codexErrorInfo`, `serverOverloaded`); the snake_case spellings
in Codex's own rollout JSONL under `~/.codex/sessions/**` are a DIFFERENT,
internal format. Reading the rollout and typing the wire from it produces a
field that never matches — check the generated bindings.

- **One classification table.** `FAILURE_CLASS_BY_TAG` maps every variant to
  `transient | quota | auth | fatal | unknown`; `CodexErrorInfoTag` is derived
  from that table's keys, so a variant cannot be classified without existing.
  An unknown or absent tag classifies `unknown`, **never** `transient` — a
  future variant must not silently earn a retry affordance.
- **Two readers, deliberately asymmetric.** `codexErrorInfoTag` parses the WIRE
  and rejects an object variant spelled as a bare string. `classifyCodexFailure`
  / `isRetryableCodexFailure` / `describeCodexFailure` take
  `CodexFailureInput = CodexErrorInfo | CodexErrorInfoTag`, because they also
  read back the already-flattened tag Kanna persisted itself. Collapsing the two
  makes an object variant (`responseStreamDisconnected`, `httpConnectionFailed`,
  `activeTurnNotSteerable`) classify `unknown` on the round trip.
- **Transport carries facts, UI owns wording.** `handleTurnCompleted` /
  `failContext` put the flattened tag on `ResultEntry.codexErrorInfo` and leave
  `result` as the provider's raw sentence. `ResultMessage` renders
  `describeCodexFailure(...)` and offers **Retry** only when
  `isRetryableCodexFailure`. No description for a tag → the raw sentence still
  shows, so an unmapped variant degrades to today's behaviour.
- **The retry callback must stay reference-stable.** `handleRetryFailedTurn`
  reaches every memoized transcript row and the row comparator checks its
  identity, so it reads `messages` + the submit fn through a ref and keeps `[]`
  deps. Depending on `state.messages` directly re-renders the whole transcript
  on every streamed chunk.

**`willRetry` is load-bearing — do not drop it again.** `ErrorNotification`
carries `{error, willRetry}`. `willRetry: true` means Codex is reconnecting on
its own and the turn is STILL LIVE; `handleNotification` must return without
calling `failContext`. Failing the turn there kills one that would have
recovered — it surfaced to users as a turn dying with the literal text
`Reconnecting... 1/5`. Absent `willRetry` (older app-server) reads as terminal.
Trade-off accepted: a `willRetry: true` never followed by a terminal event
leaves the turn hanging where it previously failed fast; Codex bounds its own
retries and Stop still works.

Not wired: `quota` (`usageLimitExceeded`) does not arm auto-continue —
`CodexErrorInfo` carries no reset timestamp, so that needs Codex's separate
`rate_limits` event. `CodexLimitDetector` still only fires on a THROWN stream
error (`claude-turn-runner.ts` catch branch); a `turn/completed` failure never
reaches it, which is why c3-227's documented precondition ("a Claude or Codex
turn emits a result event with subtype: error") is still only half true.

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
background runs plus the `deliverSubagentToMain` re-entry that /clears main on
every delivery.

# A queued message carries the whole dispatch, and the builder must not enumerate it

`buildEnqueueMessageResult` (`event-store-write-ops.ts`) owns exactly three
things — the generated `id`, `createdAt`, and a defensive copy of
`attachments`. Everything else on `QueuedChatMessage` is the caller's dispatch
metadata and must survive **verbatim**, so the builder **spreads**
`...message`. It used to list the fields by hand, which made every addition to
`QueuedChatMessage` a silent data-loss bug: an omitted optional property in an
object literal is not a type error, so nothing failed to compile and nothing
failed at runtime — the field simply vanished.

`cronRun` was lost exactly that way, and the queue is the only place it could
be lost: the tag is the sole link between a fired cron run and the turn that
answers it (`fireCronJob` → `enqueueMessage` → dequeue → `ActiveTurn.cronRun`
→ `store.onTurnTerminal` → `cron_run_outcome`). With no tag, **every cron run
finished unattributed and stayed `running` forever**, so each later tick either
orphan-healed it (`errorCode: "orphaned"`) or skipped it as
`previous_run_active` — and on the inline path each orphan-then-restart ran
`clearChatContext`, killing and respawning that chat's claude process every
cycle. The tell in a live log is the total absence of `cron_run_outcome
{ok: true}` while `turn_finished` events are present.

**Do not re-enumerate the shape here**, and note that the cron fire suite fakes
`enqueueMessage` and hand-preserves the tag — it is *more* faithful than
production was, which is why it stayed green. The round-trip is pinned against
the real `EventStore` in `event-store.test.ts`.

# A session in use is never torn down — `startingTurns` is part of "in use"

A turn registers its `ActiveTurn` only **after** the provider session spawns
(`claude-turn-starter.ts`), so for the whole boot window `startingTurns` is the
only signal that a chat is live. All three teardown gates — `enforceClaudeSessionBudget`
(LRU eviction), `isClaudeSessionIdle` (idle reaper), and `clearClaudeSessionContext`
(`/clear` and inline cron fire) — now delegate to **`isSessionInUse`**
(`claude-session-state-queries.ts`), the single predicate that covers all seven
in-use conditions (activeTurns, startingTurns, pendingTools, pendingPromptSeqs,
hasLiveWorkflow, hasPendingBackgroundTask, selfWakeActive). The eviction case
is the sharpest: a **warm** session reused for a follow-up still carries the
*previous* turn's `lastUsedAt`, so it sorts **first** in LRU — without the
`startingTurns` guard the prime eviction victim is the chat the user has just
come back to. `clearClaudeSessionContext` needs it because inline cron
re-checks `isChatBusy` and then awaits twice before calling it, so a turn can
legitimately start inside that window.

## A turn is settled by the session that OWNS it, not the one that is resident

`closeClaudeSession` deletes the `claudeSessions` entry **first**. So by the
time `runClaudeSession`'s `finally` unwinds, `claudeSessions.get(chatId) ===
session` is false for any teardown initiated anywhere but the runner — and
gating the fail-close on that residency check skipped it entirely:
`recordTurnFailed`, `activeTurns.delete` and `pendingTools.discard` never ran.
The result was a **ghost `ActiveTurn`**: a turn that never ended, a chat busy
forever, and no terminal event for any observer — including the cron outcome
hook.

`ActiveTurn.sessionId` binds a turn to the session it runs on, and the `finally`
now splits its guards by what each one actually owns:

- **map delete + OAuth release** — residency (`isCurrentSession`), unchanged.
- **settling the turn** — ownership (`active.sessionId === session.id`). A turn
  that declares no session falls back to the residency rule, so a missing
  binding can never leave a turn unsettled.
- **`pendingTools.discard`** — skipped only when a *successor* session is
  resident, which owns its own parked requests.

A superseding session's bookkeeping is still left strictly alone: wiping it
leaves its stream running headless (no isError branch fires → `sessionToken`
never cleared → the next turn loops on the same too-large `--resume` context).

# Queued messages are released on commit, not on dequeue

A queued message is a chat's only durable "start this once idle" trigger. For a
user it is a convenience; for an autonomous loop the wake **is** the queued
message, so losing one strands a still-armed loop with nothing left to wake it.

`dequeueAndStartQueuedMessage` therefore no longer removes the message up
front. It passes `StartTurnForChatArgs.onTurnRecorded` — invoked the moment
`recordTurnStarted` makes the turn replayable from the event log — and the
removal happens there. `runBuiltinCommand` takes the same callback so `/clear`
releases after the context wipe and `/compact` at its turn record. **Do not
move the release earlier**: removing it before the turn is durable is exactly
the bug (chat c87ab0ad, 2026-08-13 — pm2 restarted the server 150 ms after the
prompt was appended and before `recordTurnStarted`; the loop stayed armed, its
queue was empty, and it sat dead for 2.5 h until the user typed "Resume").

`recoverQueuedMessages` (`queued-message-recovery.ts`, called from
`server.ts` boot, detached) is the other half: nothing on boot ever drained the
queue — it was drained only by live events — so a surviving message would still
sit forever. Recovery is best-effort and sequential; a chat that refuses to
start is logged and skipped, never fatal to boot.

Replay is idempotent via `isPromptAlreadyAppended`: a turn that appended its
`user_prompt` and then died leaves that entry trailing, so the restart passes
`appendUserPrompt: false`. Identity is the durable `autoContinue.scheduleId`
when present, else exact content, and only against the TRAILING entry — in
steady state that is a `result`, never the prompt about to run.

The check is gated behind `{ replay: true }`, which ONLY `recoverQueuedMessages`
passes. Reading the transcript costs a full load plus a deep clone, and replay
is the only path that can hit a stale prompt — so the steady-state drain never
pays for it. Keep it that way: dropping the gate puts a MB-scale read on every
queued send.

Residual window (accepted): a crash between `recordTurnStarted` and the spawn
still loses the wake. That is two adjacent store writes, down from the whole
spawn — which on a slow MCP boot was seconds.

The loop-specific half of this story — `recoverArmedLoopWakes` (the wake that
died WITH the server), `handleFailedLoopTurn` (the wake lost while the server
kept running), the `loop_armed`/`loop_disarmed` tombstone that makes a disarm
visible and `resume_loop` possible, and the un-armed delivery prompt that names
the plan absolutely or names nothing — is in
`.claude/skills/kanna-loop/SKILL.md`.

See `adr-20260813-queued-message-dequeue-on-commit`.

# Observability (OTel traces + metrics, memlog, SIGUSR2 heap snapshot)

Three independent concerns, one adapter (`src/server/otel.adapter.ts` — the
ONLY file that may import the OTel SDK/exporters), initialized from
`server.ts` boot right after `appSettings.initialize()` (the telemetry
setting gates OTel export) and shut down in the server stop path:

- **OTel traces + metrics** — gated by the user-facing telemetry setting
  (Settings page → "Telemetry Tracing"; `telemetry: {enabled, endpoint}` in
  `settings.json`, default ON with endpoint `https://kanna-otel.lowbit.link`,
  the grafana/otel-lgtm compose on the lowbit Dokploy). Enabled, it registers
  a `NodeTracerProvider` (BatchSpanProcessor → OTLP http) and a
  `MeterProvider` (periodic reader, `KANNA_OTEL_METRIC_INTERVAL_MS`, default
  15000). Precedence lives in the pure `src/server/otel-config.ts`
  (`resolveOtelConfig`): `KANNA_OTEL=disabled` hard-disables,
  `KANNA_OTEL=enabled` enables even when the setting is off, else the setting
  decides; `OTEL_EXPORTER_OTLP_ENDPOINT` beats the settings endpoint;
  `KANNA_OTEL_SERVICE_NAME` beats the derived name. Service name defaults to
  `kanna-<machine name>` (sanitized `getMachineDisplayName()` — each install
  reports under its computer name; the raw name rides the `host.name`
  resource attribute). The `service.version` attribute is always set to
  `APP_VERSION` (`package.json` version, bumped by release-please on every
  release) so every span and metric is version-tagged — TraceQL
  `{resource.service.version="1.37.0"}` selects and
  `by (service_version)` groups in Prometheus. The toggle applies at RUNTIME:
  `AppSettingsManager.onChange` → `ObservabilityHandle.applyTelemetrySettings`
  restarts/stops the providers, and the facade's instrument cache is cleared
  on each transition (`resetMetricInstrumentCache`) so cached counters never
  record into a shut-down provider. Init never throws: a broken collector
  must not take the server down.
- **Memory log** — `KANNA_MEMLOG_MS` (default 60000, `0` disables) prints one
  `[kanna/mem] rss=…` line per interval. This is the correlation record for
  the next OOM kill; three OOMs (1.06–2.43 GB) went undiagnosed for lack of
  exactly this.
- **Heap snapshot** — `kill -USR2 <pid>` writes a Chrome-DevTools-loadable
  v8 `.heapsnapshot` under `<dataDir>/heap-snapshots`
  (`KANNA_HEAP_SNAPSHOT=disabled` opts out). The only way to answer "WHAT
  holds the bytes" on a live process.

**Domain code imports `src/server/observability.ts` ONLY** — a pure facade
over `@opentelemetry/api` (`withSpan`, `addCounter`, `recordUpDown`). With no
SDK registered every call is the api package's no-op, so instrumentation
needs no test doubles and costs nothing when disabled. Never import the
adapter from domain code; never import SDK packages outside the adapter.

Instrumented so far: `kanna.turn.start` (spawn pipeline), `kanna.subagent.run`
(whole run, the loop's unit of work), `kanna.loop.wake.deliver`, counters
`kanna.subagent.run.finished`, `kanna.autocontinue.fired`,
`kanna.queued_message.recovered`, `kanna.loop.wake.recovered`,
`kanna.turn.tokens`, `kanna.turn.cost_usd`, `kanna.subagent.tokens`, and
process-memory gauges. Spans nest via AsyncLocalStorage — add depth with a
one-line `withSpan` at the call site, no handle threading.

**Token spend — `kanna.turn.tokens`, `kanna.turn.cost_usd`,
`kanna.subagent.tokens`.** Turn and run COUNTS cannot answer "what is this
install spending": a 200k-token turn and a 2k-token turn are one turn each.
These are what a fleet-wide cost question reads.

**The `kind` values PARTITION the billed tokens, and that is load-bearing.**
`ProviderUsage.inputTokens` arrives already including the cache reads
(`claude-usage-math.ts` sums direct + cacheCreation + cacheRead into it), so
`splitBilledTokens` (`src/shared/token-pricing.ts`) reports `input` as the
NON-cached remainder — the same subtraction `computeCostUsd` makes, kept beside
it so the two can never disagree about what was billed. Emitting both whole
would bill the cache twice and overstate every install. `sum(...)` over the
metric is therefore the billable total; `sum by (kind)` splits it.

**A kind with nothing to report is omitted, never recorded as zero.** Absent
usage means the provider told us nothing, which is a different claim from "this
turn was free" — and the providers really are uneven here: Codex reports usage
only after a `thread/tokenUsageUpdated` notification, OpenRouter's token counts
come from upstream, and **PTY-mode turns have no price resolver wired at all**
(`createJsonlEventParser` takes none), so `kanna.turn.cost_usd` is deliberately
sparser than `kanna.turn.tokens`. Read a missing series as unknown, not zero.

**Usage reaches the metric on `ActiveTurn.usage`, not through the callback.**
`onTurnTerminal` carries only `(chatId, outcome)` and must keep doing so, so
both runners stash the result entry's usage on the ActiveTurn — Claude/
OpenRouter at `claude-session-runner.ts`, Codex at `claude-turn-runner.ts`,
both through `billedUsageOfResult`, which settles the entry-level-cost vs
`usage.costUsd` precedence in ONE place. Terminal paths with no result entry
(cancel, spawn failure) stash nothing and so record nothing. Subagent runs
never pass through that choke point at all and are recorded separately at
`subagent-orchestrator.ts`'s `subagent_run_completed` emission — which is where
a loop's spend actually shows up, since its per-iteration cost is a subagent
run, not a chat turn.

**Duration histograms — `kanna.turn.duration_ms`, `kanna.subagent.run.duration_ms`.**
Turn duration is recorded from `EventStore.onTurnTerminal` (`agent-coordinator.ts`),
the one choke point every provider terminal path funnels through, enriched from
`activeTurns.get(chatId)` — the same lookup the cron-outcome consumer already
does there, valid because a turn leaves the map only after its terminal record
persists. `ActiveTurn.startedAt` is REQUIRED and carried over from the
`StartingTurn`, so the measurement includes spawn cost. A terminal with no
ActiveTurn (a background-task self-wake) records nothing rather than a
fabricated duration. Do NOT widen `onTurnTerminal`'s signature to carry this —
24 call sites would ripple to serve one observer.

**`DURATION_BUCKETS_MS` is load-bearing.** OTel's default explicit boundaries
stop at 10s and a turn runs seconds to tens of minutes, so without the adapter's
view every observation lands in the `+Inf` bucket and `histogram_quantile`
returns garbage. `observability.test.ts` pins it by asserting turn-length
durations land in distinct finite buckets.

**Metric names are constants, because an alert query reads them back.**
`PROCESS_RSS_BYTES`, `SUBAGENT_RUN_FINISHED`, `TURN_DURATION_MS`,
`SUBAGENT_RUN_DURATION_MS`, `TURN_TOKENS`, `TURN_COST_USD` and
`SUBAGENT_TOKENS` live in `observability.ts` and are consumed by
`src/ops/alerting/rules.ts`. A rule naming a metric that does not exist selects
no series and therefore never fires — indistinguishable from a healthy fleet —
so `rules.test.ts` asserts every `kanna_*` token in a query resolves to an
exported instrument. A new instrument must also be added to
`EXPORTED_PROM_METRICS` in its Prometheus form (`_total` for a counter, the
`_bucket`/`_count`/`_sum` expansion for a histogram) before any rule may name
it.

# Performance alerts → GitHub tickets

A fleet performance regression opens its own GitHub issue on
`cuongtranba/kanna`, labelled `performance` + `agent-fix`, carrying the firing
query, every affected host, and the code hints an agent needs to start.
Prometheus → Grafana alert rule → webhook contact point → GitHub
`repository_dispatch` → `.github/workflows/perf-alert.yml`. See
`adr-20260821-perf-alert-github-tickets` and component `c3-234`.

**Everything that decides what an alert is, and what the ticket says, lives in
this repo.** Grafana holds only the payload template it was given by
`scripts/grafana-alerts.ts`. `src/ops/alerting/rules.ts` is a flat spec table
(query, threshold, summary, runbook, `codeHints`) over a builder that hides
Grafana's rule model. Apply with `bun run scripts/grafana-alerts.ts`
(`--dry-run` prints redacted payloads); it is idempotent — rules keyed by uid,
contact point by name, route merged.

- **Instance-level rules, version-level grouping.** Rules query per install so
  the ticket can name every affected host; the notification policy groups by
  `alertname` + `service_version`, so ten breaching installs are ONE ticket. A
  fix targets a release, not a laptop. Installs older than 1.38.0 report no
  `service_version` at all — queries must never require the label; those group
  as `@unversioned`.
- **`mergePerfRoute`, never a rebuilt policy.** Grafana's notification-policy
  endpoint is a whole-tree PUT on a shared instance; building the tree from
  scratch would delete routes this repo does not own.
- **Minimum-volume guards are not defensive trimming.** At current fleet volumes
  one failed subagent run out of five is a 20% failure rate. The failure-rate
  and latency rules `and` themselves against an `increase(...) >= N` clause.
- **Unarmed rules ship paused, with a `baselineNote`.** `kanna.turn.duration_ms`
  has no history, so both latency rules are applied paused until a threshold can
  be set from observed p95 rather than guessed. `rules.test.ts` requires the note
  on any unarmed rule; arming is one flag plus a re-apply.
- **Ticket noise is bounded on purpose.** Dedup by a readable
  `<!-- kanna-alert:… -->` marker (not a hash — a mis-grouped ticket is
  diagnosed by reading it), a 6h quiet period before a repeat firing comments,
  and `MAX_OPEN_PERF_ISSUES` (10). The cap is deliberately IGNORED on the
  resolve and reopen paths, so a storm can still close what it opened. **The
  OTLP ingest endpoint is unauthenticated**, so forged metrics can drive this
  path; the cap is what bounds that.
- **`AlertRuleSpec.ticketScope` decides what a ticket IS, and therefore both
  how it dedups and what a resolve means** (`adr-20260822-perf-alert-ticket-scope`).
  It is one field rather than two flags because those are one question:

  | scope | marker | on resolve | rules |
  | --- | --- | --- | --- |
  | `release` | `<alertname>@<version>` | closes | the two `…ReleaseRegression` rules, whose query compares releases |
  | `condition` | `<alertname>` | **stays open** | the three absolute-threshold rules (memory, subagent failures, turn latency) |

  Scoping a condition per release was the second flap, after
  `adr-20260822-perf-alert-reopen-dedup` fixed the first. release-please cuts
  several releases a day, so a problem that survives the upgrade got a fresh
  dedup key on every deploy: #855 (@1.41.0) and #863 (@1.41.3) were filed
  hours apart WITH the reopen fix already live. A condition ticket also never
  auto-closes — #863 opened at 10:19 and closed at 10:24, and a five-minute dip
  under the threshold is not the work being done. Whether a rule is firing
  right now is Grafana's question; the ticket tracks the fix.
- **The scope rides the wire, and must keep doing so.** `buildRuleGroup` emits
  it as the `ticket_scope` ANNOTATION (`TICKET_SCOPE_ANNOTATION`), exactly as
  `promql` / `threshold` / `code_hints` already travel; `perf-issue.ts` reads it
  off the payload. Looking it up from `ALERT_RULES` instead is the obvious
  refactor and it breaks the pipeline: `perf-alert.yml` runs the script with
  **no `bun install`** on purpose, so importing `rules.ts` drags in
  `observability.ts` + `@opentelemetry/api` and the job dies on module
  resolution — with tickets simply never appearing. `perf-alert-workflow.test.ts`
  pins `perf-issue.ts` at zero runtime imports. Anything but an explicit
  `condition` reads as `release`, so a notification from a Grafana state
  predating the annotation behaves exactly as it did.
- **Both marker shapes close with `" -->"`,** so neither substring-matches the
  other: tickets filed under the old `@<version>` key for a now-condition rule
  are left alone rather than adopted. Expect exactly one new ticket per
  condition rule after applying, then stability.
- **A flap is one episode, so it gets one ticket** (`REOPEN_WINDOW_MS`, 7 days).
  `decideAction` is fed CLOSED tickets as well as open ones and REOPENS the most
  recently closed match instead of filing a new one. Dedup over open issues
  alone was not dedup: auto-close on resolve meant the next breach matched
  nothing, so a rule hovering at its threshold filed a fresh ticket per flap —
  five identical `KannaMemoryPressure` tickets in five hours (#827, #833, #836,
  #840, #843). The quiet period never covered this; it throttles chatter on a
  ticket that is already visible, and a closed one is not. Past the window a
  breach is a genuinely new episode and resurrecting a months-old thread reads
  as noise. **`scripts/perf-alert-issue.ts` must query `state=all`** —
  narrowing it back to `state=open` restores the bug with every unit test still
  green, which is why `perf-alert-workflow.test.ts` asserts the query string.
- **Closing as _not planned_ is the mute**, and for a `condition` rule it is the
  ONLY way the ticket ever ends. `CloseReason` is `completed | not_planned`; the
  adapter maps GitHub's `not_planned` AND `duplicate` onto the latter (both say
  "not the ticket to track this on" — reopening either would undo a human
  decision). It is scoped by marker, so muting one rule cannot silence another,
  and muting `@1.40.4` cannot silence `@1.40.5`. The gesture has no UI affordance
  hinting it exists, so `renderIssue` names it in every ticket footer, pinned by
  a test — delete that line and the mute becomes undiscoverable.
- **The mute is checked BEFORE the reopen window, and is not bounded by it.**
  The two ask different questions — the window asks "is this the same episode",
  a mute asks "should this be tracked at all" — and a decision to stop tracking
  does not age. Resolving the mute through `mostRecentlyClosed` (which filters by
  `REOPEN_WINDOW_MS` first) made every deliberate mute expire after seven days,
  silently, and the rule start filing again. Do not fold the check back in.
- **`repository_dispatch` only fires a workflow that is already on the DEFAULT
  branch.** A dispatch sent while `perf-alert.yml` exists only on a feature
  branch returns `204 No Content` and runs nothing — verified, and there is no
  error anywhere to notice. It fails safe (Grafana re-notifies on its repeat
  interval, so the first notification after the merge files the ticket), but it
  means the pipeline cannot be proven end-to-end from a PR branch.
- **Grafana's rule-group `interval` is SECONDS as a number.** A duration string
  is rejected with a bare `400 bad request data` that names no field, while the
  individual rules validate fine — so the failure looks like it is anywhere but
  there. `rules.test.ts` pins the type.
- **Two silent-failure modes are gated by tests, not review.**
  `perf-alert-workflow.test.ts` asserts the workflow's `repository_dispatch`
  type equals `PERF_ALERT_EVENT_TYPE` (a mismatch is accepted by GitHub and
  matches no workflow — alerts just vanish), and the workflow's `concurrency`
  key serialises runs per alert so the read-then-write dedup cannot race two
  dispatches into two issues.

**One manual step:** the contact point needs a GitHub token permitted to POST
repository dispatches (classic `repo`, or fine-grained with Contents: write).
It is passed to the applier as `KANNA_GITHUB_DISPATCH_TOKEN` and stored as a
Grafana secure setting — never in the repo. The workflow itself needs no
secret; it uses the built-in `GITHUB_TOKEN`.

# Transcript memory is bounded by bytes, and loaded lazily

Transcript JSONL is never compacted, so a chat's transcript has no size limit
(measured on one install: 379 MB across 152 chats, largest 13.7 MB). Two
consequences, both fixed — and both easy to reintroduce.

**`TranscriptCache` budgets bytes, not chats.** `maxChats = 4` was never a
memory bound: MEASURED, the four largest transcripts on that install cost
**220 MB RSS** (~4.7x their 47 MB of source text, parsed to JS objects). The
cache now enforces `maxBytes` (default 24 MiB of SOURCE bytes ≈ 110 MB RSS)
alongside the chat cap, and always retains the most recent entry so a single
oversized transcript degrades to a re-read instead of thrashing. `set()` takes
the source size — `loadTranscriptWithBytes` hands it over for free — and falls
back to `estimateTranscriptBytes` when a caller has no cheap size. **A count
cap over unbounded-size items is not a bound**; do not swap back.

**`startTurnForChat` no longer loads the transcript per turn.**
`store.getMessages` loads the whole file AND deep-clones it — tens of MB of
heap on a big chat, every turn, pinning that chat in the LRU. It is now behind
`loadExistingMessages`, a thunk. The title check short-circuits on
`chat.title === "New Chat"` and `!chat.hasMessages` first, so an established
chat never triggers the load; the primer thunk runs only when a primer is
actually built. Adding an unconditional `deps.store.getMessages(...)` back to
this path silently restores the whole cost.

`state.subagentRunsByChatId` is now capped at `MAX_SUBAGENT_RUNS_PER_CHAT`
(200) settled runs per chat — oldest settled runs are evicted on each terminal
event (`applySubagentEvent`, `event-store-subagent.ts`); running runs are never
evicted. The `entries[]` array inside each retained snapshot is capped at
`MAX_SUBAGENT_ENTRIES_PER_RUN` (2000) — oldest entries are spliced out when the
cap is exceeded, keeping the most recent interactions in memory.
`seenMessageIdsByChatId` (dedup gate in `EventStore`) is capped at
`MAX_SEEN_MESSAGE_IDS` (2000) per chat via FIFO eviction — oldest entries
dropped first using Set insertion order. Safe because Claude API always generates
fresh `messageId`s per response; historical ids that age out will never repeat.
Without the cap, a long-running server accumulates one entry per message forever.
`state.autoContinueEventsByChatId` is evicted only by whole-chat delete, but its
dominant contributors are now bounded — see **Cron run-event retention** below.
`compactLoopWakeEvents` (`auto-continue/compact-loop-wakes.ts`) also trims
superseded `loop_armed` events: once a later `loop_armed` or `loop_disarmed`
arrives, all prior loop-state events (`loop_armed`, `loop_disarmed`,
`loop_run_outcome`) carry no weight in any live read and are dropped. When the
loop is currently disarmed every loop-state event is dropped. MEASURED before
this fix: 285 KB for one long loop chat, 91% of it the same rendered loop prompt
re-embedded on every wake by `deliverSubagentToMain`.

# Cron run-event retention (`compactCronRunEvents`)

The auto-continue log never expires, so a recurring `/cron` job wrote into it
forever. MEASURED on one install: 8,507 cron run events were **96%** of every
auto-continue event and **69%** of the whole snapshot (2.29 MB of 3.34 MB),
worst chat 2,599. That array is resident in memory AND re-walked by
`deriveCronJobs` on every chat broadcast (`read-models.ts`) and for every chat
on the global cron topic (`ws-router-envelope.ts`) — so the cost of an
unrelated UI update grew with the number of fires.

`src/server/cron/compact.ts` keeps each job's newest `MAX_RECENT_CRON_RUNS`
**settled** runs plus **every run still in flight**, and reclaims everything
before a job's most recent `cron_armed`. Re-measured on the same data after the
change: 8,860 → 353 events (−96%), 2.16 MB → 677 KB (−69%), worst chat
2,603 → 11, with **zero** read-model difference across all 21 chats.

**Why it is safe:** `pushRun` already discards everything past
`MAX_RECENT_CRON_RUNS`, so this only stops STORING what the read model throws
away. Retention is DERIVED from that display cap, not chosen — there is no N to
set wrong. `deriveCronJobs` and `findRunningCronRuns` are the complete reader
set and both are asserted unchanged over a compacted log.

**Three invariants that are load-bearing, not defensive:**

1. **Never drop an unsettled `cron_run_started`.** `evictSettled` only selects
   settled records. Losing a live start inverts `hasActiveRun` (`fire.ts`),
   which starts a CONCURRENT run — and inline mode then calls
   `clearChatContext` on a live turn.
2. **Drop a start and its outcome atomically.** They share one record. A
   surviving half-pair makes `reconcileCronRunsAtBoot` write a bogus
   `errorCode:"orphaned"` — every boot, forever.
3. **Evict oldest-first, and do NOT count in-flight runs against the budget.**
   `CronScheduler.rehydrate` reads the newest record as `lastSeen`; losing it
   makes boot emit a false `server_offline` skip claiming up to 100 missed
   fires. Charging a pin against the budget would evict a settled record still
   inside the read model's newest-N window.

Applied at the only two places the per-chat array is built:
`applyAutoContinueToState` (shared by live append AND boot replay) and the
snapshot load in `event-store-snapshot.ts`. Do NOT add a third enforcement
point — `buildSnapshotFile` serializes already-compacted memory.

**Irreversible.** Once `snapshotAndTruncateLogs` runs the dropped events are
gone from `schedules.jsonl`; reverting the module does not bring them back. The
user-visible record lives in the transcript log (`cron_run` cards), a different
log that is never compacted.

**The corpus has since outgrown the numbers above.** Re-measured 2026-08-19:
1.0 GB across 262 chats, largest single transcript **96 MB / 36k entries**
costing **524 MB peak RSS** to parse (5.4x, not 4.7x). `evict()` previously
kept a `size > 1` guard that prevented the sole cached entry from being dropped
even once it grew past `maxBytes` via `appendTo()` — pinning 524 MB RSS
permanently. The guard is removed: a solo entry that exceeds the budget IS
evicted, and subsequent reads use `getRecentMessagesPageTail` (a small tail
chunk, not a full load) because the hot paths — history primer,
proactive-compact trigger, subagent scope primer — already took the tail path
when the transcript is not in cache. **pm2 7.0.3 silently clamps
`max_memory_restart` at 2^31** (both `"3G"` and `"4G"` resolve to
`2147483648`), so raising the ceiling is not available — only lowering RSS is.

**The proactive-compact trigger reads the TAIL, not the transcript.**
`shouldInjectProactiveCompact` runs on every send and needs only the newest
`context_window_updated` / `compact_boundary`; it used to get them from
`store.getMessages`. It now calls `EventStore.getLatestContextWindowUsage`
(`getLatestChatContextWindowUsage` in `event-store-messages.adapter.ts`), which
walks backwards over `readTranscriptTail` windows. Three invariants, each of
which cost a measured regression to find:

- **The scan is TRI-STATE** (`scanLatestContextWindowUsage` in
  `proactive-compact.ts`). `found: false` (nothing decisive in this window) is
  not `found: true, usage: null` (a `compact_boundary` — conclusive). Collapsing
  them makes every chat past a compact widen to BOF on every send, forever.
- **Windows do not overlap.** Each round passes `endOffset = tail.lineOffsets[0]`
  so no byte is read twice. Re-widening from EOF instead re-parses everything
  already seen: measured 644 ms / 791 MB versus the full load's 216 ms / 291 MB
  — slower and heavier than the code it replaced.
- **`USAGE_SCAN_MAX_LOOKBACK_BYTES` (8 MiB) bounds the walk.** MEASURED: 241 of
  264 transcripts contain NO usage marker at all (imported and PTY sessions never
  emit one), so "scan to BOF" is the common path, not the tail case. A marker
  further back than one turn cannot describe the current context window anyway.

`SendCommandStore.getLatestContextWindowUsage` is **optional by design** and must
be resolved with an explicit `if`, never `??` — `null` is a meaningful, common
answer, so coalescing falls straight back into the full load on exactly the
chats this protects. Optional because the agent-suite store fakes are injected
as `store as never`: a required member typechecks and then fails at runtime,
which is the regression `adr-20260813-transcript-memory-budget` records as
"tried and reverted". See `adr-20260819-context-window-usage-tail-read`.

# Autonomous loops — `/loop`, `setup_loop`, the oracle, the tracking file

Long-horizon autonomous loops run notification-driven, with a per-iteration
`/clear` on the main agent and the tracking file (`PROGRESS.md` by default) as
the ONLY durability contract. Main context is intentionally ephemeral; there is
no timer-based `schedule_wakeup` (removed — it superseded
`adr-20260603-agent-self-scheduled-wake`).

**`.claude/skills/kanna-loop/SKILL.md`** holds the design: the
orchestrator/worker split and the wake path, `setup_loop` and its five arm-time
refusals, the four-case oracle table and the TERMINAL CHECK, `run_verify`
memoization, the structured tracking-doc MCP tools, loop-armed tool blocking,
Progress-panel rows and chunk labels, per-subagent `maxTurns`, the three
lost-wake recovery passes, and the disarm/resume tombstone.

Read it before editing the rendered loop prompt — `validateLoopSetup` asserts a
list of exact substrings, so an edit that drops one fails validation.

# Background Task Keep-Alive (Bash + Agent + Workflow — KANNA_PTY_BACKGROUND_TASK_MAX_MS)

Claude-Code background tasks (`Bash(run_in_background: true)`, background
`Agent`/Task-tool runs, workflows) run as children of the claude process. If
the idle reaper (`isClaudeSessionIdle`) fires while one is in flight, the
child dies with the process — silently, since a reap is not an error (this
killed a mid-flight background Agent one second after its commit; see
`adr-20260722-background-agent-keepalive` and, for the original Bash-only fix,
`adr-20260604-adr-20260604-pty-background-task-keepalive` — the doubled prefix
is the real filename, a `c3x add adr` defect, not a typo here).

- **Guard.** `session.isHoldingWork(now)` mirrors `hasLiveWorkflow`:
  consulted by both `isClaudeSessionIdle` and `enforceClaudeSessionBudget`, it
  holds the session warm while the task set is non-empty. Whether the deadline
  is consulted at all depends on the signal — see **Level-sourced** below.
- **Level-sourced (SDK) — the deadline does not apply**
  (`adr-20260808-background-task-level-signal-authoritative`). The first
  `background_tasks_changed` snapshot calls `session.applyLevelSnapshot(...)`,
  which sets the sticky level-sourced flag. From that point SET MEMBERSHIP is
  authoritative: `session.isHoldingWork(now)` is true for any non-empty set
  and `session.guardExpired(now)` is always false, so the wake ladder is
  unreachable. This is what the SDK prescribes (`sdk.d.ts`
  `SDKBackgroundTasksChangedMessage`). Required because *silence is not death*:
  a `vite dev` server prints its banner and goes quiet for hours — in chat
  1ed924dd the task's output file last grew at 12:45:04 and the watchdog woke
  the user at 13:14:39, so an output-growth probe would have fired too. The
  flag is sticky across an emptied set but starts `false` at every spawn,
  matching the SDK's per-process reset rule. The launch regex must NEVER call
  `applyLevelSnapshot` — it is PTY's only signal. Note the two predicates
  therefore no longer partition `size > 0`.
- **Primary signal (SDK driver).** The SDK's `system/background_tasks_changed`
  LEVEL event — the full set of live background tasks after every membership
  change, REPLACE semantics (a missed edge bookend can never wedge a stale
  set). Normalized to a hidden `status` entry carrying
  `backgroundTaskIdsSnapshot`; the runner swaps `session.backgroundTaskIds`
  for each snapshot. `in_process_teammate` tasks are filtered (long-lived by
  design; claude-code gh-30008 excludes them from its own wait loop too).
  `system/task_notification` remains the per-task edge clear.
- **Fallback / PTY detection.** The stream consumer parses each `tool_result`
  (`backgroundTaskIdsFromToolResult`) for BashTool's
  `Command running in background with ID: <id>` line AND AgentTool's
  `Async agent launched successfully… agentId: <id>` launch text (marker-gated
  so incidental "agentId:" strings never arm). This is the only launch signal
  on the PTY driver (CLI ≥ 2.1.x writes no system rows to the transcript
  JSONL, so `session.applyLevelSnapshot(...)` is never called there and the
  guard stays **deadline-based**) and a version-skew fallback on SDK. Duplicate
  arms vs the level signal are harmless (Set). Arming through this path must
  never call `applyLevelSnapshot`.
- **Stream activity bump.** The runner refreshes `session.lastUsedAt` on every
  appended transcript entry, so task-notification self-wake turns (which start
  no Kanna turn) never count as idle — mirrors claude-code's own invariant
  that the idle timer starts only after its run loop exits.
- **Clear.** Pending ids are removed ONLY by settle edges and level snapshots.
  A real user `chat.send` (NOT auto-continue / agent wakes, which bypass `send`)
  **re-arms** the guard — it refreshes the deadline and restores the wake budget,
  it does not release anything (`claude-send-command.ts`). Clearing on send is
  what let the reaper silently kill a healthy long-running watch ~10 min after
  any user message; `adr-20260801` inverted it.
- **Bound.** `KANNA_PTY_BACKGROUND_TASK_MAX_MS` (default 1_800_000 = 30 min,
  via `positiveIntegerFromEnv`) caps how long a hung/never-completing task can
  pin a process — but ONLY for a session with no level signal (PTY / old CLI /
  pre-first-snapshot). There is deliberately no ceiling on a level-sourced
  session: the SDK imposes no time limit on background tasks either, so a task
  in the set holds its session until the SDK retracts it. The residual risk is a
  live stream whose upstream task list wedges, which pins that session until
  server restart; a crashed transport still releases via the runner's `finally`.
- **Self-wake status + task list UI
  (adr-20260802-background-selfwake-status-ui).** Task-notification self-wake
  turns stream entries with NO ActiveTurn, so the turn-event fold alone left
  the chat "idle" while the model worked (observed: 70+ min of post-turn work
  with a static composer arrow). `ClaudeSessionState.selfWakeActive` tracks
  the live wake window — armed by the runner on model-activity entries
  (assistant_text / assistant_thinking / tool_call / tool_result) with no
  active turn, disarmed on the wake turn's `result`, dead with the session —
  and `getActiveStatuses` overlays it as status `"running"` (pure live
  overlay; event-sourced turn timings untouched). `cancelChat` gained a
  no-active-turn branch: when `selfWakeActive`, it appends `interrupted`,
  interrupts the session stream in-band (SDK; PTY drops the dead session),
  and suppresses the interrupt tail result via `cancelledResultPending`.
  The guard set was upgraded `backgroundTaskIds: Set<string>` →
  `backgroundTasks: Map<string, SessionBackgroundTask>` (single source;
  `taskType`/`description` from the `background_tasks_changed` snapshot —
  the normalizer now emits `backgroundTasksSnapshot` meta alongside the ids —
  with the launch-regex fallback enriched from the launching tool_call's
  description via `session.recentToolDescriptions`). Per-chat task lists
  flow `getBackgroundTasksByChatId` → `deriveChatSnapshot` →
  `ChatRuntime.backgroundTasks` → `BackgroundTasksSection` (chat footer,
  /tasks-style: type icon + description + id + live elapsed). Budget
  eviction skips `selfWakeActive` sessions; the idle reaper still keys on
  `lastUsedAt`, so a wedged flag cannot pin a session forever.

# Workflow Status Panel (disk-watch, read-only — SDK + PTY)

Surfaces Claude Code's native `Workflow` tool (dynamic multi-agent
orchestration) in the UI: a per-chat panel listing every run with live status +
drill-in progress, plus an inline transcript card on the launch. **Read-only,
both drivers.** Since the move to notification-driven loop orchestration the
model handles workflow harvest via `delegate_subagent({run_in_background: true})`
status-check spawns; this panel *displays* the workflow.

**SDK driver registration (`adr-20260616-adr-20260616-sdk-pty-feature-parity`).** Claude writes
the `wf_*.json` sidecars regardless of driver, so the SDK reuses the same
disk-watch read-model. `AgentCoordinator.maybeRegisterSdkWorkflowsDir` derives
`<projectDir>/<session-uuid>/workflows` (via `computeWorkflowsDir`) from the
SDK's first `session_token` HarnessEvent and calls `workflowRegistry.register`
once per session; `closeClaudeSession` unregisters. The PTY path keeps its own
transcript-path registration (guarded by driver preference so neither
double-fires).

**Why disk-watch, not the event stream.** The PTY transcript JSONL (PTY's sole
event source) carries the `Workflow` tool_use launch but **no**
`task_started`/`task_updated`/`tool_progress` lifecycle lines — those flow only
through the SDK live stream-json channel, which PTY never reads. Claude instead
writes a complete, self-updating sidecar per run:
`~/.claude/projects/<encoded-cwd>/<session-uuid>/workflows/wf_<runId>.json`
(`runId`, `taskId`, `workflowName`, `status`, `agentCount`, `totalTokens`,
`phases[]`, `workflowProgress[]` per-agent tree, `result`/`error`/`summary`).
`taskId` joins a run to the transcript's `Task ID: X` launch text.

**Independent read-model (does NOT violate c3-225).** The watcher feeds a sibling
read-model, never the transcript/turn event pipeline (same spirit as reading
subagent files). See `adr-20260603-workflow-disk-watch-read-model`.

- **Adapter** `src/server/workflow-watch-io.adapter.ts` — the only IO; lists +
  reads `wf_*.json`, `fs.watch` with ~250 ms debounce, and **re-arms via the
  nearest existing ancestor** when `workflows/` doesn't exist yet (Claude
  creates it lazily on the first Workflow call, after registration).
- **Registry** `src/server/workflow-registry.ts` — per-chat watch + parse
  (one defensive choke-point `parseWorkflowRunFile`) + `snapshot()` (light,
  heavy fields stripped) + `getRun()` (full) + `subscribe()`. Mirrors
  `PtyInstanceRegistry`. IO injected (side-effect seal). **Re-run masking
  (no ADR — the decision is recorded only here and in `workflow-registry.ts`):**
  Claude embeds the `runId` in the
  persisted workflow script filename, so a fix-and-relaunch via `scriptPath`
  reuses the same `runId` (new `taskId`) and pours agents into the same live
  dir WITHOUT rewriting the prior sidecar. A no-op **crash sidecar**
  (`isStaleCrashSidecar`: `status=failed && agentCount===0 && agents:[]`) is
  therefore the ONLY terminal status `snapshot()`/`getRun()` will override —
  and only when the live `journal.jsonl` proves a re-run (≥1 agent), surfacing
  a synthetic `running` row that carries the crash sidecar's `taskId`/
  `workflowName` so the launch card binds. The discriminator is content-based
  (agentCount 0 vs non-empty journal), NOT mtime ordering (clock-racy, fails
  under concurrency). `completed`/`killed`/`failed-with-agents` sidecars win
  unconditionally; a true crash (empty journal) stays `failed`. Re-run over a
  completed/killed run is out of scope (the synthetic row has no `taskId` from
  disk, and reading the transcript taskId would breach the c3-225 invariant).
- **Driver** registers `<projectDir>/<claude-uuid>/workflows` derived from the
  resolved `transcriptStream.filePath` basename (Claude mints its OWN session
  UUID and ignores `--session-id` on new sessions, so kanna's `sessionId` is
  NOT the dir name). A `workflowRegistrationCancelled` flag prevents a late
  `register()` after `cleanupResources` `unregister()` on fast-failing spawns.
- **Transport** WS topic `{type:"workflows", chatId}` → `workflowRunsUpdated`
  snapshot push (mirrors `pty-instances`); `workflows.getRun` command for the
  heavy drill-in payload.
- **Client** `workflowsStore` (stable `EMPTY` ref), `WorkflowsSection` panel
  (mirrors `SubagentsSection`), `WorkflowMessage` transcript card (live pill
  joined by `taskId` once `chatId` is threaded through the transcript rows).

Out of scope: global cross-chat view, stop/relaunch.

# Single-Session Import Live-Tail (KANNA_IMPORT_FOLLOW_*)

`FollowedSessionRegistry` (`src/server/followed-session-registry.ts`) stat-polls
a single-session import's source Claude transcript file and re-imports the
delta as the source grows, so an imported chat that is still actively being
written to by Claude Code keeps catching up. Three env vars tune it, all
consumed in `src/server/server.ts`:

- `KANNA_IMPORT_FOLLOW_POLL_MS` — stat-poll tick interval driving
  `followedSessionRegistry.tick()`. Default `2000`.
- `KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS` — a single-session import only
  auto-arms tailing when the source file's mtime is within this window of
  "now" (otherwise the source is treated as already finished). Default
  `600000`.
- `KANNA_IMPORT_FOLLOW_IDLE_MS` — the registry stops following a session
  after this long with no file growth. Default `600000`.

# Kanban Boards — the card's lifecycle

One card is one worktree is one branch is one chat (`board-start-work.ts`).
That chain is what makes three agents on three cards safe: each has its own
checkout, so they cannot touch each other's files.

**A column's behaviour comes from its `semantic`, never its title.**
`ColumnSemantic` is `start | active | review | done`, all optional — a board
that marks none simply does not move cards, and the feature never guesses a
column from what the user called it. Only `active` and `done` drive anything.

**The card moves automatically at exactly two moments, and they are not
symmetric:**

| Moment | Who moves it | Where to |
| --- | --- | --- |
| "Start work" | Kanna (`moveToActiveColumn`) | the `active` column |
| work is finished | **the agent**, via `mcp__kanna__card_move` | `findAdvanceColumn` — one step forward |
| card reaches `done` | only ever the user | — (raises the cleanup question) |

**Why the agent moves its own card and Kanna does not.** There is no turn-end
hook, deliberately: a card takes as many turns as it takes, so "the turn ended"
is not "the work is done" — a host-side move would advance the card the first
time the agent stopped to ask a question. Instead `buildStartWorkPrompt` names
the card id and the destination column id, and asks for the move *when the work
is done and verified*. The card id has to ride the prompt because the agent has
no other way to learn it; without it the agent would have to read the whole
board back and guess which row is its own, which is why `card_move` sat unused
before this. If a deterministic signal is ever wanted, it belongs on an
acceptance oracle (the `run_verify` shape), not on the turn boundary.

**`findAdvanceColumn` picks by ORDER, not semantic** — the next column by rank
(`listColumns` sorts by it). A board names at most one `review` column while it
may hold several stages between `active` and `done`; the built-in Dev pipeline
runs `In progress → Test → QA → Deployment`, so jumping to the `review` column
would skip a stage. One step forward is the only reading that fits every
template.

**`done` is unreachable that way, on purpose.** Reaching it reports the item
CLOSED to a connected tracker (`remoteStateOfColumn`) and raises the worktree
question — merge / discard / leave (`worktree-cleanup.ts`), asked and never
performed, because a column drag is one gesture with no undo and uncommitted
work exists nowhere else. Those are the user's decisions. A board whose only
successor is `done` (the GitHub template's `Open / In progress / Closed`)
advances nothing, and the prompt then says nothing about moving rather than
improvising a destination.

**Agent-origin writes are held back from the tracker.** Every board write
carries a `CardActor`; the MCP tools attribute `{kind:"agent", chatId}`, and
`board-sync.ts` holds such a change with `heldReason: "agent_push_disabled"`
unless that binding set `allowAgentPush`. An agent advancing a card must not
silently close a real issue.

**Agent tools** (`kanna-mcp-boards.ts`, registered only with a `boardRegistry`
+ `chatId` + `projectId`): `board_list`, `board_get`, `card_move`,
`card_create`, `card_comment`. Two disciplines carried over from the
tracking-doc tools: `board_get` returns COUNTS plus a 20-card window and never
a whole board (a 5k-issue import would otherwise blow up one turn), and every
id is resolved against the chat's project before any write, so an agent cannot
reach another project's board by guessing an id.

**C3 has the decisions but not the map.** Five ADRs record why boards are
shaped as they are — `adr-20260810-boards-sqlite-store` (SQLite, not the event
log), `adr-20260811-board-column-semantics-single-source`,
`adr-20260811-board-in-the-workspace`, `adr-20260811-board-owns-its-rendering`,
`adr-20260811-card-start-work` — and they are the first thing to read before
changing this feature. Boards also shipped without a **component** fact; three
now carry it — `c3-310` (boards-domain, `src/shared/boards/**`), `c3-232`
(boards, `src/server/board-*.ts` plus the MCP and WS surfaces), and `c3-119`
(boards-ui, `src/client/**/boards/**`) — each with a `code-map.yaml` block.

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

# Wiki

Public docs site lives in `wiki/` (Astro Starlight) and is deployed to
https://kanna-wiki.lowbit.link on every push to `main` that touches `wiki/**`.

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

# Package Auto-Update (c3-237 + c3-312)

`PackageUpdateManager` (`src/server/package-update-manager.ts`) manages update
detection and application for three package kinds: `skill`, `claude-plugin`,
`codex-plugin`. Component facts: c3-237 (server), c3-312 (shared types/parsers),
c3-116 (PluginsSection UI). ADR: `adr-20260902-package-auto-update`.

**Six load-bearing invariants — do not violate silently:**

1. **Applies are serialized.** `applyUpdates()` throws if `status === "applying"`.
   The UI must disable the Apply button while applying. Concurrent CLI invocations
   could corrupt lock files.

2. **`unknown` is NOT `up_to_date`.** `UpdateAvailability` has four values:
   `up_to_date`, `outdated`, `partial`, `unknown`. `unknown` means the check
   failed (network error, GitHub rate-limit). Do not coerce it to `up_to_date`
   or suppress it in the UI — render a distinct state so the user knows to retry.

3. **Auto-apply defers when any chat is busy.** The `hasAnyChatBusy()` dep is
   injected into `PackageUpdateManagerDeps`. Never remove it or bypass the check
   in `maybeAutoApply` — a running CLI during an active turn can interfere with
   conversation tools.

4. **All state is in-memory; the upstream lock files are the source of truth.**
   Kanna writes no sidecar. `PackageUpdateSnapshot` and `autoApplyHistory` (capped
   at 50) are rebuilt from scratch on every check and lost on server restart.
   Never introduce a Kanna-owned `~/.kanna/packages/` file without an ADR.

5. **A skill is located upstream by its `skillPath`, never by folder base name.**
   `classifySkillUpdate` resolves the lock's `skillPath` through
   `UpstreamTreeIndex.byPath`; `byName` is a fallback for lock entries that
   record no path. A repo may vendor one skill into many agent directories —
   `pbakaus/impeccable` ships 18 copies, all at depth 3 — so a base-name index
   picks whichever tied first and compares the installed hash against a SIBLING
   copy. That reads as `outdated` forever and no update can clear it. When
   `skillPath` is present and a complete tree lacks it, the folder is gone
   upstream: do **not** fall back to a same-named folder elsewhere.

6. **A pinned skill is never offered a plain update, and never auto-applied.**
   `skills update` resolves upstream AT the lock's `ref` and exits 0 having
   changed nothing, so `InstalledPackage.pinnedRef` decides the affordance:
   `repinTarget()` (the single source read by the card, the applier, and the
   manager) names the tag to move to, and the applier issues
   `skills add <repo>/<folder>#<tag>` instead. `maybeAutoApply` and "Update all"
   both skip pinned packages — satisfying a pin means REPLACING it, which is an
   explicit choice about which version to run. The applier re-reads the lock
   after the CLI exits and fails a pinned apply whose revision did not move;
   exit 0 alone cannot distinguish an update from a no-op.

**Re-pin targets are resolved by version, never by list position.**
`resolveLatestTag` tries `releases/latest` first, then the highest semver tag via
`pickLatestSemverTag` (`src/shared/packages/tag-order.ts`). GitHub returns tags
in lexicographic-descending order, so `v20260102-production-cleanup` precedes
`v11.13.4` — reading position is what left a pinned skill with no resolvable
target. Resolution runs only for pinned packages that are behind, so it costs
nothing on an ordinary check.

**Adding a fourth package kind** requires:
- New union member in `PackageKind` (`src/shared/packages/types.ts`)
- New parser in `src/shared/packages/parse-*.ts`
- New checker adapter in `src/server/*-update-checker.adapter.ts`
- New applier adapter in `src/server/*-update-applier.adapter.ts`
- Entry in `package-update-appliers-boot.adapter.ts`
- UI changes in `PluginsSection.tsx`
- Entries in `.c3/eval/c3-237.yaml`, `.c3/eval/c3-312.yaml`, and `.c3/code-map.yaml`

**`CODEX_BINARY_PATH`** is the only env var for this feature. Defaults to
`~/.local/bin/codex`. No other behavior is env-var gated — all configuration
lives in Settings → Packages (`PackageUpdateSettings` in `settings.json`).

# Plugin System (Paseo-parity)

Third-party plugins that compile to two bundles (a browser one and a server
one), run their server half as a **subprocess** speaking typed RPC over a unix
socket, and contribute UI to the sidebar, the chat footer and a Settings page.
Design: `PLUGIN-SYSTEM-PLAN.md`. Plan/progress: `PROGRESS-plugin-system.md`.

**Plugins are OFF by default** (`plugins.enabled`, `PLUGIN_SETTINGS_DEFAULTS`).
Every surface — HTTP routes, MCP tools, client host registry — stays dark until
a user opts in.

**One `PluginService` per process, via `plugins/plugin-service-host.ts`.** The
CLI, the HTTP routes and the MCP tools all drive `getPluginService()`. A second
instance would keep a second registry, so a plugin installed over HTTP would be
invisible to `plugin_list` and `reload` would restart a child no other surface
could see. Tests swap it with `setPluginServiceForTest` and MUST restore `null`.

**`install` writes BOTH bundles.** It used to build `built.client` and discard
it, which made `GET /api/plugins/:id/client.js` unserveable no matter what the
route did. `client.js` is served `no-store`: the bundle is rebuilt in place at
the same url, so a cached copy silently defeats `plugin reload` — which is the
entire point of that command.

**A failed RPC is `200 {ok:false}`, not a 4xx.** The transport succeeded and the
caller needs the plugin's own message; only a malformed REQUEST is a 4xx. A
well-formed id that is not installed is `404`, and a **disabled** surface is
`404` everywhere — never `403`, which would advertise that plugins exist.

**The id is validated before any path join.** It becomes a directory name
downstream, so a traversal-shaped id is rejected at the routing layer.

**Mounting cost three extractions, not three raised allowances.** Three modules
sat EXACTLY on their architecture-budget ceilings, so each got the remedy the
budget message prescribes: `SettingsPage.tsx` 2787 → 2449 (`SkillsSection.tsx`,
which `PLUGIN-SYSTEM-PLAN.md` itself prescribed), `KannaSidebar.tsx` 1007 → 964
(`SidebarUtilityNav.tsx` — also the natural home for plugin nav entries, which
are navigation destinations exactly like Workflows/Cron/Settings), and
`ChatTranscriptViewport.tsx`, which was two lines under the 700 threshold and so
mounts the footer panel through `PluginsFooterSlot` to keep the call site to one
import and one element.

**`usePluginContributions` is the whole wiring.** It turns the global switch into
loaded contributions in `pluginContributionsStore`. Without it every mounted
surface renders permanently empty — which is precisely the state the feature was
in for a whole phase: components written, mounted nowhere, nothing feeding them.

**Testing a component that reads a zustand store needs `renderClientMarkup`,
not `renderToStaticMarkup`.** zustand v5 serves `getInitialState()` as the
`useSyncExternalStore` SERVER snapshot, so a static render never observes a
`setState` and a working panel looks broken. That helper exists for this and
documents it.

**Installs persist through `settings.installedPlugins`, not through the
service.** `PluginService`'s registry is in-memory, so it takes an injected
`InstalledPluginStore` port: `install`/`setEnabled` write through it, and
`restore()` re-registers from the record WITHOUT recompiling, because the build
output the install produced is already on disk. `installed-plugin-store.ts`
binds that port to the normalized CRUD collection settings already had. Without
this a CLI install was invisible to the running server and every surface
reported nothing after a reboot, while the bundles sat on disk the whole time.

**Two boot points configure it, and both are deliberate.** The server wires it
in `createHttpDispatcher` — that factory runs once, already holds `appSettings`,
and using it avoids touching `server.ts`, which sits EXACTLY on its 807-line
budget ceiling. The CLI wires it in its own `plugin` arm, because it is a
separate process. That CLI boot step is **injectable** (`preparePluginService`):
the default constructs a real `AppSettingsManager`, so a test driving
`setPluginServiceForTest` must pass a no-op or the real wiring silently replaces
its fake — which is exactly the regression that caught it.

## `addCommandCenterItem` — a plugin entry in the `/` picker

Merged **client-side**, in `src/client/lib/plugin-slash-commands.ts`. It cannot
go through `local-catalog-io.adapter.ts`: that catalog is DISK-scanned on the
server and its `scope: "plugin"` means **Claude Code** marketplace plugins
(`skills/`, `commands/`, `SKILL.md`) — a different, older feature — while a
Kanna plugin contributes at RUNTIME from an evaluated browser bundle.

**Selecting a plugin command inserts the item's `prompt` TEXT, never `/name`.**
Every other picker entry becomes a `SlashCommandNode`, whose text content is
`` `/${name}` ``, and survives because something downstream resolves that name:
`runBuiltinCommand` intercepts a builtin, and the claude CLI reads a
project/personal/Claude-Code-plugin command off DISK. A Kanna plugin command has
neither, so `/my-plugin:greet` would reach the CLI as a command it rejects — a
picker entry broken by construction. `prompt` is therefore a REQUIRED field on
`PluginCommandCenterItemInput`, and the expansion resolves entirely in the
browser before anything is sent. `$applySlashCommandSelection`
(`SlashCommandTypeaheadPlugin.tsx`) owns the two branches.

**Namespaced `<pluginId>:<name>`, and a taken name is DROPPED, not replaced** —
so a plugin can add to the picker but never shadow a builtin. The dedupe is not
belt-and-braces: `local-catalog-io.adapter.ts` already names Claude Code plugin
commands `<pluginName>:<command>`, the same shape, so the collision is real. The
prompt map is returned FROM `mergePluginCommands` rather than derived from the
item list at the call site, so a dropped item can never still answer a lookup and
hijack the catalog entry that beat it.

**Provider-independent, and always was.** A plugin entry is prompt text Kanna
inserts locally, so it works on every provider exactly as a builtin does. It
predates the catalog itself becoming provider-independent (see **Local skills on
every provider**), which is why `commandsForProvider` — the filter this merge
used to sit after — no longer exists.

**Every client `add*` needs a no-op twin in
`src/server/plugins/plugin-child-entry.adapter.ts`.** Both bundles compile from
the same entry and the server child runs it whole, so a method missing from that
mirror is not an inert call — it is a TypeError inside `contribute`, after which
the child never reports ready and the plugin dies at startup on a timeout that
names nothing. Adding `addCommandCenterItem` to the `hello` fixture is what
surfaced it.

**Deferred by the plan, so not gaps:** `addTheme`,
`addTimelineTransformer/Renderer`, `addComposerPill`, `addAttachmentSource` —
the surfaces where a bad plugin degrades the core product rather than occupying
its own page.
