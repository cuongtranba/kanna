---
name: kanna
description: Router and shared ground rules for ANY work in the Kanna repo — read this first to find the specialist skill for the task. Use whenever the work touches this codebase: adding a feature or a field, changing a type or contract shared between server and client, wiring a new event or read-model, a chat/session that got stuck or behaved wrong, metrics and performance questions, React or client UI edits, running tests or clearing lint and ast-grep gates, cutting a release, reviewing a PR, or "where does this live" and "what else do I have to update". Use it especially when the task spans several of those, when it starts with "what's the best way to…" or "how do I add…", or when you are unsure which Kanna skill applies — routing costs one short read and prevents guessing at conventions this repo enforces mechanically.
---

# Kanna — start here

Kanna is a local-first Bun + React agent host: an event-sourced server (`src/server/`),
a React client (`src/client/`), and shared contracts (`src/shared/`). Most of what
looks like a style preference here is actually enforced by a gate — ESLint,
ast-grep, or a test — so a change that "looks fine" can still fail CI. This skill
routes you to the specialist that knows the relevant gate, and holds the few rules
that apply to every task regardless of area.

## Route by symptom

Match the task to a row and read that skill before you start. Paths are relative
to the repo root, so `Read` works even if the skill does not auto-trigger.

| The task involves | Read |
| --- | --- |
| A chat/session id, "why did this turn fail", stuck or hung turn, a tool that never returned, wrong model, billing to API instead of subscription | `.claude/skills/kanna-debug/SKILL.md` |
| Metrics, spans, traces, Grafana, "no telemetry arriving", the OTel collector, "why is it slow", memory growth, RSS, an OOM kill | `.claude/skills/kanna-telemetry/SKILL.md` |
| Editing `.tsx`/`.ts` under `src/client/**` — components, hooks, formatting helpers, layout, tooltips | `.claude/skills/kanna-react-style/SKILL.md` |
| Running tests, a green-locally-red-on-CI failure, lint / ast-grep / design-gate errors, "how do I verify this" | `.claude/skills/kanna-test/SKILL.md` |
| Publishing a version, changelog, npm release | `.claude/skills/release/SKILL.md` |
| Reviewing a pull request for safety or correctness | `.claude/skills/review-pr/SKILL.md` |
| Adding a field the server sends and the client renders, or otherwise changing a contract across the WS boundary | `src/shared/types.ts` defines it once, both sides import it — never redeclare the shape on the client. Then `.claude/skills/kanna-react-style/SKILL.md` for the render, and `c3` if it moves a boundary |
| "Where does X live", component boundaries, whether a change needs a doc update | the `c3` skill (see below) |
| Visual design, spacing, color tokens, typography polish | the `impeccable` skill; `DESIGN.md` at the repo root is the source of truth |
| Deploying or debugging infra on the lowbit Dokploy host | the `dokploy` skill |
| Adding a shadcn/ui primitive | `.claude/skills/shadcn/` |

Several rows can apply at once — a slow UI render is `kanna-telemetry` for the
measurement and `kanna-react-style` for the fix. Read both; they are short.

## Rules that apply to every task

These hold no matter which specialist you land on.

**Query C3 before you code.** `.c3/` holds this repo's architecture facts —
component boundaries, contracts, ADRs, and the rules each component must follow.
Run `/c3 query <topic>` (or `c3x lookup <file>`) before editing, even for a small
change. The facts record decisions whose reasons are not visible in the code, so
skipping the lookup means patching against assumptions the repo already discarded.
If your change moves a boundary, alters a public contract, or adds an
architecture-significant file, update `.c3/` in the same PR — drift is treated as
a blocker.

**Work in a git worktree.** Land changes on a branch in a worktree rather than the
main checkout: several agents run against this repo concurrently, and a shared
checkout means they overwrite each other's edits.

**Write the test first.** New behavior is two commits — the failing test, then the
implementation. The split is what proves the test can actually fail; a test written
alongside its implementation can be a tautology that passes for the wrong reason.

**Fix the root cause.** Prefer the correct change over the quick one. A workaround
that leaves the underlying defect in place is not done, and "done" here means no
follow-up items left open.

**Let the code explain itself.** Default to zero comments: name things well and
extract helpers instead. Comment only to record *why* — an invariant, a constraint,
a workaround the code cannot express on its own.

**One source of truth, flowing one direction.** A value should be defined once and
derived everywhere else. When you find the same fact in two places, the fix is to
delete one, not to keep them in sync.

**Design for the lowest total complexity** (Ousterhout). Prefer deep modules — a
simple interface over substantial implementation — to a chain of shallow helpers.
Keep tightly related logic together and extract only when the extraction earns a
real abstraction. Design the interface before the implementation, and ask whether
the change leaves the system easier to understand, not merely whether it passes.

**Look up unfamiliar libraries.** Use Context7 for any library you are installing,
upgrading, or using in an unfamiliar way, rather than recalling an API that may
have shifted.

**Verify before reporting.** `bun run test`, `bun run lint`, and `bun run typecheck`
must pass — see `.claude/skills/kanna-test/SKILL.md` for the flags that matter and
the failures that only reproduce on CI. Report what actually happened: if a check
failed or you skipped one, say so plainly.

## Diagrams

When explaining architecture or brainstorming a design, a Mermaid diagram usually
carries the shape better than prose. Kanna renders Mermaid inline, so a syntax
error reaches the reader as a broken diagram — validate every diagram with
`mcp__kanna__validate_mermaid` before you send it. Quote any label containing
`[ ] ( ) { } |` or `"`, or one starting with `/`; write dotted link ends in full
(`-.-x`, not `-.x`).

## Working on the skills themselves

These files have two consumers: Claude Code auto-triggers on the `description`
frontmatter, and Kanna's own `/` picker parses the same files through
`LocalCatalogService` (`src/server/local-catalog-io.adapter.ts`, fact `c3-231`).
That parser is line-based, so a description must stay on **one line** — a folded
`>-` block silently reduces to an empty description in the picker. `user-invocable:
false` hides a skill from the picker while leaving auto-triggering intact; use it
for skills only ever reached by routing.
