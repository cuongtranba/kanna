# Kanna

A local-first web UI and server for Claude Code and Codex agents: an event-sourced Bun
server, a React client, and shared contracts. Start any task at
`.claude/skills/kanna/SKILL.md`, a symptom-to-skill router; the specialist skills listed at
the end of this file auto-trigger on their own.

# Commands

```bash
bun install
bun run dev            # Vite+ client (`vp dev`) :5174 + server :5175; needs Node 22.18+ on PATH
bun run start          # single-process server, production shape
bun run check          # vp check (lint + types) → lint:comments → build:client → check:bundle
bun run test [file]    # bun --bun vp test run (Vitest under Bun); never bare `bun test`
bun run lint           # vp lint --deny-warnings (Oxlint, rules in lint.config.ts)
bun run typecheck      # vp check --no-lint (tsgolint); never bare tsc
bun run check:arch     # architecture and test-style ratchets
```

CI (`.github/workflows/test.yml`) also runs `lint:usestate` (ast-grep), `lint:limits`,
`check:commits` and gitleaks. Local only: `bunx ast-grep test` (rule fixtures),
`bun run test:e2e` (Playwright, real Chrome), `bun run setup:hooks` (once per clone).

# Repo layout

```
src/server/      event-sourced server; *.adapter.ts are the only IO leaves
src/client/      React client
src/shared/      contracts both sides import; a type lives here once
src/beacon/      beacon agent (own IO seal); apps/beacon-win7/ is its Go port
src/ops/         ratchets, alerting specs, test-suite and skill guards
rules/           ast-grep rules; rule-tests/ holds their fixtures
scripts/  e2e/   dev and CI scripts; Playwright specs
wiki/            docs site, its own package; root lint and test skip it
.c3/             architecture facts, ADRs, eval bindings
```

# Every task

- **Before coding**, load the owning component: `c3x lookup <file>` or `/c3 query <topic>`.
  **After coding**, if a boundary, contract or rule changed, run `/c3 change` in the same PR.
- Work on a task branch in its own worktree; never commit to `main`.
- `origin` (`cuongtranba/kanna`) is the only remote and `gh` has no default repo, so always
  pass `--repo cuongtranba/kanna`.
- Conventional Commits. release-please silently DROPS a commit whose body line starts with
  `word(` followed by a nested `(`. Check with `bun run check:commits --range origin/main..HEAD`.

# Design (A Philosophy of Software Design)

Read the `kanna-design` skill before adding a module, command, setting, store or protocol
string. The rules every change follows:

- **One owner per decision.** A bound, vocabulary, format, route, subject or env name is
  defined once and imported. Before writing one, grep for it; merge copies, never add one.
- **Deep modules.** The interface is simpler than the implementation. No pass-through
  methods, props or parameters, and no `utils`/`helpers` bucket.
- **Pull complexity down.** If every caller would pass the same option, check the same null
  or catch the same error, the module does it once. Define errors out of existence.
- **Never raise a pin.** `check:arch` fails when a defect population grows, and also when it
  shrinks without its pin being lowered in the same PR.

# Hard rules (each enforced; the gate's message explains the fix)

- **IO seal:** fs, sqlite/pg, child_process, http, `Bun.spawn`/`$`/`file`, `process.env`
  and `process.exit` only in `*.adapter.ts`, tests, `__fixtures__`, `test-helpers` and
  `adapters/`. Anything else takes the operation as an injected port (`bun run lint`).
- **Types:** no `any`, no `as` or `<T>` casts, no `unknown` in any position in production.
  JSON is `JsonValue`/`JsonObject` from `src/shared/json.ts`, narrowed with `isJsonObject`;
  caught errors go through `toError()`. A predicate is written `v is JsonValue & Foo`.
- **No comments** in first-party TypeScript (`src/`, `scripts/`, `e2e/`); only tool
  directives survive, and an `oxlint-disable` or `eslint-disable` gives its reason after `--`
  (`bun run lint:comments`). Facts go in names, `.c3/`, an ADR or the wiki.
- **UI:** read `DESIGN.md` first. Tokens from `src/index.css` only: no hex, no
  `backdrop-blur`, no native `title`. Semantic colour is a fill; text uses `-text` tokens.
- **React:** selectors and hook arguments are reference-stable; state transitions are
  named store actions, not JSX logic; every client side effect runs through
  `runPendingAction` and renders its pending state (`kanna-react-style`).
- **Tests:** import from `"vite-plus/test"`, never `bun:test`; use `import.meta.dirname`,
  never `import.meta.dir`. No `vi.mock` or `vi.doMock`: inject the dependency as a
  defaulted parameter. Unmount every React root you mount. Subprocesses get
  `stdin: "ignore"` and `GIT_TERMINAL_PROMPT=0` (`kanna-test` has the runner facts).
- **Secrets:** a synthetic credential in a fixture gets one narrow `regexes` entry in
  `.gitleaks.toml`, never a `paths` glob. gitleaks is pinned at v8.30.1, which has no
  `protect` command.
- **Skills:** a SKILL.md description stays on one line in the third person, at most 1,024
  characters; Kanna's `/` picker parses it line by line (`src/ops/skills/`).

# `.c3/` hazards

- `c3x` can rewrite files you never touched. Run `git status .c3/` after every c3x write
  and revert what you did not intend.
- In table cells, escape `*` and `_` as `\*` and `\_`. A literal `|` cannot survive in a
  cell: reword instead.
- An ADR needs YAML frontmatter (`c3x add adr` writes it), or `repair` deletes it.
- Keep list items on one line; a wrapped item loses its indent.
- Run `c3x check` after editing `.c3/`; CI does not, and one unsealed fact breaks every
  lookup.
- A new, renamed or deleted architecture-significant file updates `code:` in
  `.c3/eval/c3-NNN.yaml` and `.c3/code-map.yaml`, then `c3x repair` and `c3x lookup <file>`.

# Docs

`wiki/src/content/docs` is the only place docs are written; the site and the GitHub Wiki
are generated from it, so never edit the GitHub Wiki. A new MDX construct needs a rule in
`wiki/scripts/github-wiki/convert.ts`.

# Skill map: touching X, read Y first

| Touching | Skill |
| --- | --- |
| Any design decision, new module or command, a `check:arch` breach | `kanna-design` |
| Writing or running tests, a lint, ast-grep or design-gate failure | `kanna-test` |
| `src/client/**` components, stores, pending state | `kanna-react-style` |
| Sessions, turns, `/clear` `/compact`, queues, keep-alive | `kanna-sessions` |
| Autonomous loops, `setup_loop`, the task list | `kanna-loop` |
| `delegate_subagent`, spawn gate, background runs | `kanna-subagents` |
| `/cron` | `kanna-cron` |
| Models, providers, custom endpoints, Codex failures | `kanna-providers` |
| Custom MCP servers, OAuth, the remote `/mcp` server | `kanna-mcp` |
| Service bus, NATS, Inbox, webhooks, Slack | `kanna-inbox` |
| Mermaid, Generative UI, share links | `kanna-genui` |
| Beacon transfer, self-update, the Go port | `kanna-beacon` |
| Boards, uploads, package auto-update, plugins | `kanna-features` |
| Spans, metrics, the collector, perf alerts | `kanna-telemetry` |
| A chat's transcript and event logs | `kanna-debug` |
| Releases | `release` |
| Reviewing a PR; filing an issue | `review-pr`; `github-issue` |

# Compaction preservation

This section stays in the root: nested rules can drop out of context after compaction.
When summarizing, preserve the objective and acceptance criteria; the user's constraints;
the implementation status; files touched; key symbols, APIs and schemas; decisions and why;
failed approaches and why; exact unresolved errors; validation commands and their latest
results; branch, worktree and git state; remaining work; and unvalidated assumptions.
Never report a task done until every criterion is met. Re-run validation on the current
tree; never trust a result recorded before a compaction.
