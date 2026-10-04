---
id: c3-315
c3-seal: 8b45677180f01799f85319394fc727d17d7679be7bb8814fdb5f5736476bcfdb
title: genui-contract
type: component
category: feature
parent: c3-3
goal: 'Define the generative UI contract once: the kanna-ui spec, the component and action catalog, dataset declarations, and the pure query engine both sides run.'
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
---

## Goal

Define the generative UI contract once: the kanna-ui spec, the component and action catalog, dataset declarations, and the pure query engine both sides run.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 Shared |
| Runtime | Pure modules imported by the server guard, the validate tool, the dataset service, and the client renderer |
| Consumers | c3-240 (server generative UI), c3-123 (generative UI renderer), c3-226 (prompt section and validate_ui) |
| Boundary | Owns the wire shape and its validation; rendering belongs to c3-123 and data access to c3-240 |

## Purpose

Owns what a generative view IS: the versioned spec, the catalog of components and actions with strict prop schemas, the fence grammar for kanna-ui and kanna-ui-intent blocks, dataset declarations for inline, file and MCP sources, the period and comparison grammar, the query engine, value formatting and variance, and the prompt section generated from the catalog. Non-goals: reading files, calling MCP servers, rendering, and chart-library options.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-strong-typing | rule | Parsed specs and dataset rows are JsonValue narrowed by Zod, never cast | must follow | Props reach components only through the catalog schemas |
| adr-20260929-generative-ui | adr | Fence contract, trust boundary, action classes, dataset sources | must follow | Records why json-render validation is not the trust boundary |
| rule-colocated-bun-test | rule | Contract behaviour is pinned by colocated suites | must follow | spec.test.ts, query.test.ts, format.test.ts, contract.test.ts, rows.test.ts |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| parseGenUISpec | IN | The trust boundary: an unknown version, component, prop, action, action param, dataset reference, or expression shape fails closed with an issue path | c3-240 | src/shared/genui/spec.test.ts |
| GENUI_COMPONENTS and GENUI_ACTIONS | OUT | The only components and actions a view may name; each action carries its class, local or kanna or agent | c3-123 | src/shared/genui/catalog.ts |
| FlowDiagram | IN | Nodes, edges and groups only, never positions; every edge endpoint and node group must name something the diagram declares or the spec fails with the field path; edge type is static by default and flow only for live work | c3-123 | src/shared/genui/spec.test.ts |
| runDatasetQuery | OUT | One engine for inline rows on the client and file or MCP rows on the server; periods count back from the latest date in the data, never the clock | c3-240 | src/shared/genui/query.test.ts |
| Fences | IN/OUT | extractKannaUiFences reports whether a fence is closed; the intent fence carries an agent action and its structured context | c3-114 | src/shared/genui/contract.test.ts |
| renderGenUIPromptSection | OUT | The prompt section is generated from the catalog, so the prompt cannot name a component the parser rejects | c3-226 | src/shared/genui/contract.test.ts |
| datasetDeclSchema | IN | An inline dataset is written as object rows or as a columns list plus rows of values, and parses to object rows so every consumer reads one shape; the prompt makes inline the default for data the agent already holds, keeps file for data already in the workspace, and its worked example must parse | c3-240 | src/shared/genui/spec.test.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/shared/genui/prompt.ts | c3-315 Contract | Wording | src/shared/genui/contract.test.ts |
| src/shared/kanna-system-prompt.ts | c3-315 Contract | Placement of the section | src/shared/kanna-system-prompt.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| An unvalidated prop reaches a component | json-render catalog validation is used in place of parseGenUISpec | A spec with a wrong prop type renders | bun run test src/shared/genui/spec.test.ts |
| Prompt and parser drift | A component or action is added without regenerating the prompt | The model writes a view the parser rejects | bun run test src/shared/genui/contract.test.ts |
| Relative periods move with the clock | resolvePeriod anchors to now instead of the data | A saved report changes on reload | bun run test src/shared/genui/query.test.ts |
