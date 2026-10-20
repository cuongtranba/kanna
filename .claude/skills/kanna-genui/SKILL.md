---
name: kanna-genui
description: Model-authored rendered content in Kanna — the mermaid validation gate (validate_mermaid, end-of-turn guard, server-side parse adapter), Generative UI (kanna-ui fences, parseGenUISpec trust boundary, datasets, actions, charts, FlowDiagram), and share links (shareableEntries allowlist, frozen datasets, v1 upgrade). Use whenever a task touches mermaid-*, src/shared/genui/**, src/server/genui/**, charts, session-share, ShareViewPage, a broken diagram, or a kanna-ui view that fails to validate or render.
---

# Kanna GenUI, mermaid, and share links

Moved verbatim from the root `CLAUDE.md`.

## Mermaid Validation Gate (KANNA_MERMAID_GUARD)

Kanna renders mermaid inline, so a syntax error reaches the user as a broken
diagram. **The model's diagrams are validated against mermaid's real parser
before they can stand.** Two layers, deliberately covering each other:

- **`mcp__kanna__validate_mermaid`** (in-turn, proactive). The model calls it
  with a diagram source and gets back `VALID`, or an `isError` result carrying
  the offending line, mermaid's caret excerpt, and a hint. It self-corrects in
  the same turn — no extra turn, and the user never sees the bad version.
  Registered whenever a `chatId` is present (subagents included), as one
  `tool()` on the in-process Kanna MCP server.
- **End-of-turn guard** (`src/server/mermaid-guard.ts`, reactive backstop). At
  the runner's success finalize (`claude-session-runner.ts`, after
  `recordTurnFinished`, **before** `maybeStartNextQueuedMessage` so the drain
  picks up what it enqueues) the server re-reads the turn's `assistant_text`,
  extracts ```mermaid fences and validates them. On a real failure it enqueues
  one correction prompt via `enqueueMessage` with a synthetic
  `autoContinue.scheduleId` — the `wakeBackgroundTaskSession` shape, NOT
  `deliverSubagentToMain`'s armed-loop shape: **no `/clear`**, because the
  model needs the diagram still in context to fix it.

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

## Generative UI (```kanna-ui, KANNA_GENUI)

The agent composes interactive views — reports, charts, statements, test results —
from Kanna's own component catalog; Kanna validates them, renders them, fetches their
data and runs their actions. **The model decides WHAT to show; nothing it writes ever
executes.** ADR `adr-20260929-generative-ui`.

- **The contract is a fence, not a tool.** A ```kanna-ui block in `assistant_text`
  carries one JSON spec. Codex receives no Kanna MCP tools
  (`codex-transcript-translator.ts` passes `mcpServers: []`), so a `present_ui` tool
  would have been Claude-only; the fence also persists and restores with the
  transcript and renders read-only in share links, where each non-inline dataset is
  answered from rows frozen into the snapshot at mint (see **Share links render
  through the chat's pipeline** below). `mcp__kanna__validate_ui` is the
  in-turn check (file datasets are resolved too); the prompt section comes from
  `renderGenUIPromptSection`, added to main chats only (`genui` option on both
  prompt builders), never to subagents.
- **`parseGenUISpec` (`src/shared/genui/spec.ts`) is the trust boundary.**
  json-render's own `catalog.validate` checks only component NAMES — on 0.21.0 it
  accepted `title: 3`, an `onClick` string prop, and an unknown action `shell.run`.
  Kanna validates every prop with a strict Zod schema, every `on` binding against
  `GENUI_ACTIONS` and its params, and dataset references; expressions (`$state`,
  `$bindState`, `$template`, `$item`, `$index`, `$cond`) are checked for shape and
  then excused from the prop schema at their position, because json-render resolves
  them recursively. `$computed` and json-render's `push`/`pop`/`validateForm`
  built-ins are rejected. **Components re-parse their resolved props at render** — a
  bound value can resolve to anything.
- **Inline is the default source for data the agent already holds.** The prompt
  used to allow inline rows only "for a few rows the user gave you" and said to write
  computed data to a file, so chat `494c0085` fetched six tables over MCP and then typed
  them back out as scratch CSVs in the user's project. An inline dataset may now be
  written as a table, `{"columns":[…],"rows":[[…],…]}` (the shape query tools already
  return), or as object rows. `datasetDeclSchema` normalizes the table to object rows at
  parse, so no consumer ever sees two shapes. `file` is for a data file that already
  exists, and `mcp` is for a view that should re-query live. `contract.test.ts` parses
  the prompt's worked example, so the example cannot teach a shape the parser rejects.
  ADR `adr-20261001-genui-inline-tabular-datasets`.
- **Datasets are resolved server-side** by `GenUIDatasetService`
  (`src/server/genui/`), except `inline` ones, which the client runs through the same
  shared engine (`runDatasetQuery`). A file must resolve inside the chat's cwd by
  REALPATH, and the chat policy's `readPathDeny` is checked against both the path as
  written and the real path — on macOS the two differ (`/var` vs `/private/var`) and
  checking only one let a denied file through in testing. An MCP tool is called only
  if it declares `readOnlyHint` or the user clicked *Allow for this chat* (in-memory,
  per chat); the MCP server's own token is the authorization, never a tenant id the
  model wrote.
- **One turn-end seam for both guards.** `composeTurnEndGuards` (`turn-end-guard.ts`)
  feeds the mermaid guard and the GenUI guard through the runner's existing
  `turnEndGuard` dep — `runClaudeSession` has little complexity headroom (122 against a
  127 ceiling), so a second call there is the wrong place for it. Codex turns get the GenUI guard only (its correction
  wording names no tool, because Codex has none). The escalation key is a content
  HASH: `ModelEscalation` logs its key, and a spec can carry inline financial rows.
- **Actions have three classes** (`GENUI_ACTIONS`): `local` (json-render state),
  `kanna` (`file.open`, `link.open` https-only, `dataset.refresh`,
  `financial.drilldown`), `agent`. An agent action is proposed in an inline confirm
  strip and, on *Send*, becomes a `chat.send` whose content is a headline plus a
  ```kanna-ui-intent block of structured context (values, period, dataset source) —
  no protocol change, and it queues like any message. json-render's `ActionProvider`
  captures its handlers ONCE, so `HandlerSync` re-registers them when the host changes.
- **Client state rules.** `useState` is banned in `src/client`, and rows are
  virtualised, so per-element UI state (tab, chart/table view, expanded rows, drill
  path) lives in the view's json-render store (`view-state-registry.ts`, bounded)
  under `/_ui/<elementKey>` and `/_drill/<datasetId>`; the element key rides an
  injected `_kannaKey` prop that `resolvedProps` strips.
- **The kanna-ui transformers live in their own module**
  (`lexical/markdown/kannaUiTransformers.ts`) and `lexicalToReact` builds its default
  list at call time. Spreading `KANNA_BUILTIN_TRANSFORMERS` at module load through
  `messageTransformers` hit an import cycle in the PRODUCTION bundle and left the
  whole app blank (`UC is not iterable`) while every bun test passed — bun orders
  modules differently. `e2e/smoke.pw.ts` is what catches this class.
- **Charts** (`charts/`): VChart **core** with explicit `register*` calls, lazily
  loaded (~360 KB gzip chunk, never in the entry). `buildChartModel` is the
  deterministic adapter and enforces one axis — a combo whose metrics differ in
  unit is refused ("use two charts"); the waterfall is a range-column whose steps
  Kanna computes. Series colours are `--chart-1..8` in `src/index.css`, the dataviz
  skill's validated palette in OKLCH; `chart-palette.test.ts` pins mark contrast
  (light slots 3–5 are documented relief slots: every chart has a Table view).
  Colours are converted from OKLCH by `oklchToRgbString`, because canvas parsing of
  `oklch()` is not reliable. Series order is alphabetical/declared, never by value,
  so a filter never repaints survivors.

- **Accessibility and visual baselines** (`e2e/genui.pw.ts`). axe-core checks both
  seeded views against WCAG 2.1 AA in light and dark, and asserts it actually scanned
  something — an `include` selector that matches nothing reports zero violations. A
  keyboard-only test changes the period, switches a chart to its table, drills in, and
  reaches *Send*. The canvas is not focusable, so **the table view is the keyboard
  path for drilldown**: each drillable row header is a button. When a drill replaces
  the button that had focus, focus moves to *Back*, and *Back* returns it to the
  chart's figure — without that, focus falls to `<body>` and a keyboard user restarts
  from the top of the page. Twenty element screenshots in
  `e2e/genui.pw.ts-snapshots/` are compared with `toHaveScreenshot`. They are named
  `-darwin` because font rasterisation differs per OS; e2e is off CI, so regenerate
  them on macOS with `--update-snapshots` after an intended visual change, and look at
  every image before committing. `--update-snapshots` rewrites only a baseline that
  FAILS, and `maxDiffPixelRatio` is 1%, so a small intended change passes against the
  old image and is never rewritten — delete the baseline first. Each capture scrolls
  its element to the top first, because the chat composer overlays the bottom of the
  transcript and would be stitched into the image.

- **FlowDiagram** (`components/flow-diagram.tsx`, `flow/`; ADR
  `adr-20261001-genui-flow-diagram`). The model writes nodes, edges and groups, never
  positions; the catalog schema rejects an edge or group reference that names nothing.
  **Edge `type` is intent, not styling:** `static` (default) is a relationship, `flow` is
  work moving now and is the ONLY thing that animates — beads on a `stroke-dashoffset`
  CSS animation, which the global reduced-motion rule freezes into a static dotted mark.
  `style: "dashed"` means optional or conditional; never reuse it for "in progress". ELK
  (`elkjs` 0.12, pinned: mermaid's 0.9.3 lacks `elk.json.edgeCoords`) lays out with
  `edgeCoords: ROOT`, and `FlowSurface` draws ELK's routed points — React Flow's own
  edge paths ignore the routes and cut through groups. Node boxes are sized by
  `measureTextWidth` (DomPort) after `whenFontsReady`; the chrome constants in
  `flow-layout.ts` must match `StepNode`'s padding, or labels truncate. The canvas is
  read-only and leaves the wheel to the transcript; **Outline** is the keyboard path.
  React Flow and ELK are lazy chunks — a static import puts ~480 KB gzip in the entry.

`KANNA_GENUI=disabled` removes the prompt section and the guard; existing views keep
rendering and `validate_ui` stays registered.

## Share links render through the chat's pipeline

A share snapshot is **version 2**: the chat's own `TranscriptEntry` values, chosen by
`shareableEntries` (`src/server/session-share/shareable-entries.ts`), plus a
`datasets` map. `ShareViewPage` renders them with `processTranscriptMessages` →
`buildResolvedTranscriptRows` → `TranscriptRowFrame`, exactly as the chat does. The
share page used to have its own renderer over a flattened version 1 message list that
kept only a tool's name and raw input, so every tool call showed as a JSON box. **Do
not give the share page its own renderer again.**

- **`shareableEntries` is an ALLOWLIST, and it is the privacy boundary.** An entry
  kind is published only if it is listed there. `account_info` (email),
  `system_init`, attachments (absolute paths), cron/loop records, hidden entries and
  `debugRaw` are withheld. A tool result keeps only the `tool_use_result` /
  `toolUseResult` sidecar, and only for the tool kinds `toolResultReadsSidecar`
  (`shared/tools.ts`) names — the ones `processTranscriptMessages` reads it for
  (AskUserQuestion, plan, task, subagent cards). Elsewhere the sidecar is a second
  copy of the result, measured at twice the size of the content itself. A new entry kind
  stays private until someone adds it on purpose; `snapshot-builder.test.ts` pins the
  withheld fields.
- **Datasets are frozen at mint, never queried by the viewer.** The viewer has no
  chat, workspace or MCP access, and a query endpoint keyed by share token would hand
  all three to anyone holding a link. `GenUIDatasetService.freeze` loads each
  non-inline dataset under the CHAT's authorization — the same realpath containment,
  `readPathDeny` and MCP approval gate as a live query, so an unapproved tool is
  recorded as unavailable and never called — and keeps only the columns the
  declaration reads (`projectDatasetRows`). The share host answers with
  `runDatasetQuery` over those rows, so period, compare and drill-down still work.
  Rewriting the views to inline datasets was rejected: the spec parser caps inline
  data at 500 rows and 64 KB.
- **`datasetFreezeKey` is key-order independent** (`JSON.stringify` with a sorted-key
  replacer). The server keys the rows from its own `parseGenUISpec` result and the
  client looks them up from json-render's, so the key must not depend on property
  order.
- **Version 1 links still render.** `snapshotTranscriptEntries` upgrades them in the
  viewer through `normalizeToolCall`. A v1 tool call kept no tool id, so results pair
  with calls in ORDER; parallel calls can mis-pair, which is accepted for links that
  expire within days anyway.

See `adr-20260929-share-view-chat-parity`.
