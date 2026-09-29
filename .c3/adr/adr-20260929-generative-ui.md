---
id: adr-20260929-generative-ui
c3-seal: a3392ad1ce041c602b385214b20dac12b67ea8efecd03d443488d116fe8289f4
title: generative-ui
type: adr
goal: Let the agent answer with interactive views — reports, financial charts and statements, test and diagnostic summaries — that Kanna validates, renders, fetches data for, and runs actions from. The model writes a versioned JSON spec in a kanna-ui fence naming components and actions from a Kanna-owned catalog; nothing it writes executes.
status: accepted
date: "2026-09-29"
---

## Goal

Let the agent answer with interactive views — reports, financial charts and statements, test and diagnostic summaries — that Kanna validates, renders, fetches data for, and runs actions from. The model writes a versioned JSON spec in a kanna-ui fence naming components and actions from a Kanna-owned catalog; nothing it writes executes.

## Context

Kanna could render markdown, mermaid and tool cards, but a request for a revenue report or a dashboard came back as prose or a static table. The handoff asked for a bounded generative UI layer on json-render with VChart charts, a strict catalog, three action classes, dataset references with a semantic layer, and read-only share rendering. Two facts constrained the design: Codex receives no Kanna MCP tools, so a tool-call contract would be Claude-only; and json-render 0.21.0 validates only component names, accepting wrong prop types, unknown actions and arbitrary params.

## Decision

The contract is a kanna-ui fence in assistant text, the same shape as mermaid: provider-neutral, persisted with the transcript, and rendered read-only in shares. mcp__kanna__validate_ui checks a spec in-turn, and an end-of-turn guard escalates an invalid view once, keyed by a content hash so inline data is never logged. parseGenUISpec is the trust boundary and validates props, actions, params, dataset references and expression shapes itself; json-render only renders. Datasets are declared by source — inline, workspace file, or MCP tool — and resolved by the server under the chat's authorization: realpath inside the cwd plus readPathDeny on both paths, and MCP tools only when readOnlyHint is declared or the user approves them for the chat. Actions are local, deterministic Kanna, or agent; an agent action is confirmed by the user and sent as an ordinary chat message carrying a kanna-ui-intent fence of structured context, so no protocol change is needed. Charts use VChart core with explicit registration in a lazy chunk, colours from validated --chart tokens, one axis per chart, and a table view on every chart.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-114 | component | The Lexical message renderer gains a KannaUiNode for kanna-ui and kanna-ui-intent fences | c3-114#n10075@v1:sha256:27c34f0051a7a59d7cab24990ec538a17e38cf2740694a17b24b0257ac9fc82f "Render each transcript entry kind (text, tool call, write_file, delete_file, plan, diff, ...) consistently, with collapse/expand and status." | The transformer list is built at call time to avoid an import cycle |
| c3-226 | component | Registers validate_ui and carries the generated prompt section | c3-226#n11853@v1:sha256:45261301f0a6af409208173fa9380d0a5c9d87a9ac356e8bd6bbf30c673b194b "Host the in-process loopback MCP server that the Claude driver attaches" | N.A - one tool added beside validate_mermaid |
| c3-208 | component | Adds genui.dataset.query and genui.dataset.approve in a separate router module | c3-208#n10914@v1:sha256:3b682e08c742ff6ed2ec0fe7e93f9508e535bd265f8c630d292aa17868013d79 "Multiplex WS traffic: route subscribe/unsubscribe/command envelopes, push projections on every state change." | Dispatch arms stay at the budget pin |
| c3-210 | component | Both runners call one composed turn-end guard; Codex gets the GenUI guard | c3-210#n11015@v1:sha256:ca6753652cc74facb772fe9c0b2c181c8ccf8285292b29d8bde2240ded58671b "Drive turn lifecycle across providers: start/cancel/resume Claude + Codex sessions, emit normalized transcript events." | runClaudeSession complexity unchanged |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/shared/genui/spec.test.ts | Rejects wrong props, unknown actions, bad params, and unknown versions | bun run test src/shared/genui |
| src/shared/genui/contract.test.ts | The prompt section names every catalog component and action | bun run test src/shared/genui |
| src/server/genui/dataset-service.test.ts | Denied, escaping, and symlinked paths return no rows; unapproved MCP tools need approval | bun run test src/server/genui |
| e2e/genui.pw.ts | Renders a file-backed report, drills down, and sends an explain-variance intent | bun run test:e2e |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A present_ui MCP tool as the contract | Codex has no Kanna MCP tools, and a tool result is not part of the rendered reply |
| json-render catalog validation as the trust boundary | It checks only component names on 0.21.0 |
| react-vchart | Its event props are typed any, which the strict-typing gate bans; core VChart with explicit registration also keeps the chunk smaller |
| Agent actions as a new WS command | A chat message with an intent fence reuses queueing, history, and rendering with no protocol change |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/shared/genui src/server/genui src/client/components/genui src/server/design/chart-palette.test.ts | spec, query, format, contract, rows, dataset service, guard, renderer, chart model, and palette suites pass |
| bun run test:e2e e2e/genui.pw.ts e2e/smoke.pw.ts | the report renders from workspace files, drills down without the agent, sends an explain-variance intent, and the production bundle loads |
| bun run check | typecheck, lint, client build, and bundle check pass |
