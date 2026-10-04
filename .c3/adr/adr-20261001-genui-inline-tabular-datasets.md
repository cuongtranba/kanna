---
id: adr-20261001-genui-inline-tabular-datasets
c3-seal: 7689221d7cf735c44beccd27b2ed2b9d50919d83577e6a4936854ecfe7348db7
title: genui-inline-tabular-datasets
type: adr
goal: Make inline the default dataset source for data the agent already holds, and let an inline dataset be written as a columns-and-rows table, so a generative view stops making the agent write a scratch CSV into the user's workspace just to show numbers it already has.
status: done
date: "2026-10-01"
---

## Goal

Make inline the default dataset source for data the agent already holds, and let an inline dataset be written as a columns-and-rows table, so a generative view stops making the agent write a scratch CSV into the user's workspace just to show numbers it already has.

## Context

Chat 494c0085 (2026-10-01) asked for diagrams from a tenant's dbt models. The agent fetched every table through an MCP query tool, then typed the same rows back out into six CSV files under .kanna/model-diagrams/ in the user's project, and pointed file datasets at them. The prompt drove this: it allowed inline rows only for a few rows the user gave you and said to write computed or large data to a file first. Inline rows were also object-per-row only, which repeats every column name on every row, while the query tool already answered in a columns-and-rows shape. A2UI makes the same split Kanna does, a data model populated as JSON inside the payload and components bound to it by path, which is the shape the inline source already offers.

## Decision

datasetDeclSchema accepts an inline dataset written either as object rows or as a columns list plus rows of values in column order, and normalizes the table form to object rows at parse, so the query engine, the renderer, the share snapshot and every other consumer still read one shape. A row whose value count differs from the columns, an array row without columns, an object row beside columns, and duplicate column names are rejected with the row's path. The 500-row and 64 KB caps stay and are measured on what the agent wrote. The prompt section makes inline the default for any data the agent holds, says a columns-and-rows tool result can be pasted as is, keeps file for a data file that already exists in the workspace, keeps mcp for a view that should re-query live, and its worked example is now an inline table. Error messages that told the agent to write a file now point at aggregation or at where the data already lives.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-315 | component | Owns the dataset declaration and the prompt section; gains a Contract row for the inline table form and the source guidance | c3-315#n13924@v1:sha256:d75ad46d438302f6a4e6bb52ed2d4a4f757cd38ae55d124441d743005fcb8fae | rule-strong-typing: rows stay JsonValue narrowed by Zod, no casts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Raise the inline caps and leave the prompt alone | The prompt, not the cap, sent the agent to a file; the session held fewer than one hundred rows |
| A separate A2UI-style dataModelUpdate message | The kanna-ui fence is one JSON object by design, and datasets already are its data model bound by id |
| Keep the table form on the parsed declaration | Every consumer would need to handle two row shapes; normalizing once at the trust boundary keeps one |

## Verification

| Check | Result |
| --- | --- |
| bun run test src/shared/genui | A columns-and-rows inline dataset parses to object rows, a misaligned row is rejected at its path, and the prompt's worked example parses |
| bun run test | Full suite passes |
| bun run check | Typecheck, lint, client build and bundle budget pass |
