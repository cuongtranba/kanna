---
id: adr-20261001-genui-flow-diagram
c3-seal: 9e29cda4930d1f351ee2f045f5395881097384e55a1848f69ac20ec1afc6a76b
title: genui-flow-diagram
type: adr
goal: 'Add FlowDiagram to the generative UI catalog: a read-only node-and-edge diagram the model writes inside a kanna-ui fence, which Kanna lays out with ELK and draws with React Flow. The model states structure and intent only — nodes, edges, optional groups, and for each edge whether it is a static relationship or a live flow — and never positions. Clicking a step opens its file or asks the agent about it with the step''s neighbours as context.'
status: done
date: "2026-10-01"
---

## Goal

Add FlowDiagram to the generative UI catalog: a read-only node-and-edge diagram the model writes inside a kanna-ui fence, which Kanna lays out with ELK and draws with React Flow. The model states structure and intent only — nodes, edges, optional groups, and for each edge whether it is a static relationship or a live flow — and never positions. Clicking a step opens its file or asks the agent about it with the step's neighbours as context.

## Context

Generative UI rendered reports, charts, statements and record views, but a diagram could only be mermaid: static, with no per-step status, no file links and no way to ask about one step. Users asked for diagrams like React Flow. A model cannot place nodes reliably, so the component needs automatic layout. Two edge meanings must stay distinct because they answer different questions: a static edge is a relationship that exists, a flow edge is a path work is moving along right now. The catalog and its parser live in c3-315 and the renderer in c3-123; the catalog entry is the public contract the prompt is generated from.

## Decision

FlowDiagram props carry nodes, edges and groups inline, capped at 120 nodes, 240 edges and 16 groups, and the catalog schema rejects any edge endpoint or node group that names nothing it declares, so a broken diagram fails at the trust boundary with an issue path instead of rendering half a graph. Edge type is static by default; flow is reserved for live work, drawn as a solid line with beads moving toward the target, and the global reduced-motion rule freezes the beads into a static dotted mark so the meaning survives without motion. Dashed style means optional or conditional, never in progress. ELK layered layout with orthogonal routing and edgeCoords ROOT runs in a lazy chunk; the renderer draws ELK's own routed points rather than React Flow's default paths, which ignored the routes and cut through groups. Direction defaults to auto and keeps whichever of left-to-right or top-to-bottom fits the panel at the larger scale. The canvas is read-only and does not capture the scroll wheel, so a transcript still scrolls past it. Every diagram has an Outline view in reading order, which is the keyboard path, the same role the table view plays for charts. Node actions are built-in affordances like TestResult's Fix: Open file when the node has a path, Ask agent with flowNodeContext, both hidden in a read-only host.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-315 | component | The catalog gains FlowDiagram with referential checks, and the prompt teaches static versus flow intent | c3-315#n13941@v1:sha256:e140fbb25533f53189f4216a5391f04a3ba4cae04886f76860fb4690e5810e4f | Prompt still generated from the catalog; contract.test.ts covers the new entry |
| c3-123 | component | The renderer gains the FlowDiagram element, a lazy React Flow surface and an ELK layout chunk | c3-123#n13942@v1:sha256:15da89abb6b7a5512a7fa8da1ccdf18e5807582f569fe9d66865d7d0f5a9d89d | Per-element state stays in the view store; resolved props are re-parsed before use |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/shared/genui/spec.test.ts | An edge to an undeclared node or a node in an undeclared group is rejected with the field path | bun run test src/shared/genui |
| src/client/components/genui/GenUIBlock.test.tsx | Ask agent sends the step with its upstream and downstream steps; the outline reads in flow order and marks live edges | bun run test src/client/components/genui |
| e2e/genui.pw.ts | Every step is laid out, only flow edges animate, a keyboard reaches a step through the outline, axe finds no WCAG AA violation, and both themes match their baselines | bun run test:e2e |
| scripts/check-client-bundle.ts | React Flow and ELK stay out of the entry chunk | bun run check:bundle |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Let the model supply node positions | Models place nodes badly and inconsistently; layout belongs to Kanna like chart scales do |
| dagre for layout | It is 17 KB but its clusters overlap each other and leave no room for a group header, which the prototype showed on the first grouped diagram |
| React Flow default smoothstep edges over ELK positions | They ignore ELK's routes and cut through groups and nodes |
| One animated flag instead of an edge type | A boolean says how to draw, not what the edge means; the type lets the prompt and the outline speak about intent |
| Nodes and edges as a dataset | They are the diagram's structure rather than rows to aggregate, and inline props keep share links working with no frozen data |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| ELK's 440 KB gzip chunk loads on a slow link | It is imported dynamically only when a diagram renders, and the outline works without it | bun run check:bundle reports the entry unchanged |
| Node boxes truncate labels | Sizes are measured with the real body font after document.fonts.ready, with chrome counted per node kind | e2e/genui.pw.ts-snapshots/flow-diagram-light-darwin.png shows every label whole |
| Flow beads distract in a long transcript | Only flow edges animate and reduced motion stops them | e2e flow test counts exactly the declared flow edges |

## Verification

| Check | Result |
| --- | --- |
| bun run check | typecheck, lint, comment ban, client build and bundle check pass; entry 171 KB gzip of 350 KB |
| bun run test | full suite passes, including the new spec and renderer tests |
| bun run lint:usestate and bunx ast-grep test and bun run check:arch and bun run lint:limits | pass |
| playwright e2e/genui.pw.ts and e2e/smoke.pw.ts | 16 passed, including the three flow tests, axe in both themes, and the new baselines |
