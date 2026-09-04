---
id: c3-314
c3-seal: 87ce921ecbf79e9b3d8a6424810a8719dea9976c64dd57e537182906c6cd84ed
title: stacks-domain
type: component
category: feature
parent: c3-3
goal: Own the pure stack-domain shapes and the activity fold that answers what is running across a stack right now.
uses:
    - rule-colocated-bun-test
    - rule-strong-typing
---

## Goal

Own the pure stack-domain shapes and the activity fold that answers what is running across a stack right now.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-3 Shared |
| Runtime | Pure; no IO, no state. Called on the read-model path and rendered by the client |
| Consumers | c3-239 (server resolution), c3-122 (stack sidebar UI) |
| Boundary | Types and folds only; resolving a binding against real projects belongs to c3-239 |

## Purpose

Houses the stack shapes both sides import once — `Stack`, `StackBinding`, `ResolvedStackBinding`, `StackSummary`, `ProjectInstructionBlock` — and `foldStackActivity`, which rolls the per-chat `ChatActivity` already computed for every member chat into one answer for the stack row. Non-goals: reading chats, resolving projects, and any decision about what a stack chat may reach.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-strong-typing | rule | One definition of each stack shape, imported by server and client alike | must follow | A type that lives twice is a type that drifts |
| rule-colocated-bun-test | rule | The fold has a colocated test | must follow | src/shared/stack-activity.test.ts |
| adr-20260904-cross-project-orchestration | adr | The rollup is a fold over data that already exists, not new state | must follow | D5 — it ships independently of any sequencing decision |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Stack domain types | OUT | Stack, StackBinding (primary or additional), ResolvedStackBinding, StackSummary, ProjectInstructionBlock | c3-3 | src/shared/types.ts |
| Stack activity rollup | OUT | A pure fold over the member chats' ChatActivity — no new events and no new state, so a stack row can never disagree with the chats it sums | c3-3 | src/shared/stack-activity.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/read-models.ts | c3-314 Contract | Snapshot assembly order | src/server/read-models.ts |
| src/client/components/chat-ui/sidebar/StacksSection.tsx | c3-314 Contract | Layout and copy | src/client/components/chat-ui/sidebar/StacksSection.tsx |
