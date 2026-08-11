---
id: adr-20260810-component-implementation-notes
c3-seal: 771bc99f2af956a41e2ce816531bd4a4eae3c5522278d9c9b19dbb6fbe82eda7
title: component-implementation-notes
type: adr
goal: |-
    Make c3-206, c3-208 and c3-302 patchable again. All three carry sections the
    `component` canvas never declared, and `change apply` validates the whole
    merged body, so every patch to any of them is rejected — which is why c3-206
    still describes transcript behavior the shipped code no longer has.
status: accepted
date: "2026-08-10"
---

## Goal

Make c3-206, c3-208 and c3-302 patchable again. All three carry sections the
`component` canvas never declared, and `change apply` validates the whole
merged body, so every patch to any of them is rejected — which is why c3-206
still describes transcript behavior the shipped code no longer has.

## Context

`check` tolerates a section the canvas does not declare, but `change apply`
validates the whole merged body — so **every** patch to such a fact is
rejected, whichever section it targets. That is not theoretical: the byte-bound
work in adr-20260810-byte-bounded-chat-page could not record its c3-206 update
and shipped with c3-206 still describing the old behaviour, including a claim
("partial tails are never cached") that the code no longer honors.

The drifted sections are all the same kind of content — deep implementation
notes about the chat-ops delta path and the transcript caches:

| Fact | Non-canvas section |
| --- | --- |
| c3-206 | Chat Op-Log (delta broadcast source) |
| c3-206 | Transcript cache |
| c3-206 | Transcript tail-read (cold-open fast path) |
| c3-208 | chat.ops delta broadcast |
| c3-302 | Chat ops delta events |

Three of 51 component docs, five sections. The remaining 48 declare nothing
outside the canvas, so this is localized drift rather than an accepted pattern
the canvas failed to describe.

Removing a section is NOT expressible. `--cite` exposes only a section's
CONTENT nodes; an empty-body block patch strips the body and leaves the `##`
heading behind (verified by applying one to an optional section and reading the
file back). A node's seal is `sha256(content)` with trailing newlines trimmed
(confirmed against a known node), but an anchor derived from a heading's
literal text still fails the drift gate with "no block seals to the cited hash"
— headings are not blocks. So the drift can be legalized, not migrated.

## Decision

Declare the five existing section names in the `component` canvas as OPTIONAL
text sections, ordered last, so the three drifted facts become valid and
patchable — then correct c3-206's content to describe the code that shipped.

This is NOT the design this ADR originally proposed. The intent was one generic
`Implementation Notes` section with the five ad-hoc sections migrated into it.
That is **not expressible**: a section heading is not a block. `--cite` exposes
only a section's content nodes, an empty-body block patch strips the body and
leaves the `##` heading (verified by applying one and reading the file back),
and the drift gate reports "no block seals to the cited hash" for a heading
anchor derived from its literal text — so no patch scope can remove a section.
With removal impossible, migrating content into a generic section would leave
the old headings behind and the facts still invalid.

So the choice is narrowed to: declare the names, or leave c3-206 permanently
unpatchable and therefore permanently wrong about its own behavior. Declaring
them wins, because a doc that cannot be corrected is worse than a canvas that
carries five optional names it would rather not.

The cost is real and should be named: `Transcript cache` is one component's
private vocabulary sitting in the contract all 51 components share. It is
mitigated only by being optional — the other 48 docs are unaffected — and it
should be revisited if the tool ever supports removing a section.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-206 | component | Its three non-canvas sections become declared, and its Transcript cache / Transcript tail-read content is corrected to the two-cache design, the byte budget, and the fact that partial tails ARE now cached | c3-206#n8288@v1:sha256:aba847843854e765c2464a52a18d4eda4ad06af2d690bc38025eb6ff027985ad "TranscriptCache (src/server/event-store-messages.adapter.ts) is a small" | ref-event-sourcing — the append-only log is what makes byte size a sound cache token |
| c3-208 | component | Its chat.ops delta broadcast section becomes declared; content unchanged | c3-208#n8397@v1:sha256:3626460943590788311aa6fa026704360ea54c24dd212bcd8e40bc5ead55ad3e "During live turns, chat-topic subscribers with a tracked per-subscription seq" | none beyond the canvas declaration |
| c3-302 | component | Its Chat ops delta events section becomes declared; content unchanged | c3-302#n9789@v1:sha256:1e94f2b1bbc09af127da6c2084ad6a305843eeec63ee5cf427ba90b7338c252c "src/shared/chat-ops.ts defines ChatOp" | none beyond the canvas declaration |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-event-sourcing | c3-206's migrated text states that an unchanged transcript byte size proves an unchanged tail — sound only because this ref makes the log append-only | ref-event-sourcing#n9962@v1:sha256:1ff5f5fcbeeb85e1ccfe24b3e3e63babaec81436d2a50381b8e0b560132fd0aa "Every state mutation is first captured as an immutable event appended to a JSONL log; system state is derived by replay + periodic snapshot compaction." | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Canvas | component gains the five existing section names as OPTIONAL text sections, ordered last | canvas-scope patch |
| c3-206 | Transcript cache rewritten for the two-cache design and the byte budget; Transcript tail-read corrected — "partial tails are never cached" is no longer true | 2 block patches |
| c3-208 | No content change; the canvas patch alone makes it valid | none |
| c3-302 | No content change; the canvas patch alone makes it valid | none |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| c3x change apply | The morph gate refuses the reshape unless every component instance is valid against the new canvas once this unit's migrations apply | change apply adr-20260810-component-implementation-notes |
| c3x check | Reports 0 errors across all facts after the flip | c3x check |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| One generic Implementation Notes section, with the five sections migrated into it | The preferred design, and not expressible: section headings are not blocks, so no patch can remove a section. Migration would leave the old headings behind and the facts still invalid. Verified by probe: an empty-body block patch strips a section's body and leaves its ## heading. |
| Fold the content into Purpose and change no canvas | Blocked by the same limitation — the old sections cannot be removed, so folding elsewhere does not make the fact valid. Independently, Purpose is declared as "concrete ownership and non-goals" and would become a dumping ground. |
| Leave the drift and hand-edit .c3/ | .c3/ instances are tool-owned; hand-editing bypasses the seal and the gates that make the docs trustworthy. |
| Make Implementation Notes required | Would strand all 48 conformant docs, turning an additive change into a repo-wide climb for no benefit. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| The canvas accumulates component-specific vocabulary, weakening it as a shared contract | The five names are OPTIONAL, so no other component is affected; the ADR records the debt and the condition for repaying it (tool support for removing a section) | c3x check across all 51 component docs |
| The morph strands a component that is not valid under the new canvas | The morph gate refuses unless every instance validates once this unit applies | c3x change apply; c3x check |
| The corrected c3-206 text drifts from the code again | The claims it now makes are the ones the tail-cache tests pin (event-store-tail-cache.test.ts) | bun run test src/server/event-store-tail-cache.test.ts |

## Verification

| Check | Result |
| --- | --- |
| c3x change apply --dry-run adr-20260810-component-implementation-notes | All patches report "would apply" with no gate failure |
| c3x change apply adr-20260810-component-implementation-notes | Canvas patch + 2 c3-206 content patches land in one transaction |
| c3x check | ok: true, 0 errors |
| grep for sections outside the canvas across all 51 component docs | 0 remaining — the five are now declared |
