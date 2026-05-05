---
id: c3-103
c3-version: 4
c3-seal: 3df29e442d4de52d6b103b61af2117a407e4e230ac218cf3a19a9edd6986816b
title: ui-primitives
type: component
category: foundation
parent: c3-1
goal: 'Ship the low-level, brand-aligned UI primitives (Radix + shadcn derivatives: button, dialog, popover, scroll-area, tooltip, select, kbd, ...).'
uses:
    - ref-strong-typing
---

# ui-primitives

## Goal

Ship the low-level, brand-aligned UI primitives (Radix + shadcn derivatives: button, dialog, popover, scroll-area, tooltip, select, kbd, ...).

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 (client) |
| Parent Goal Slice | "Render the chat experience" — primitives keep interaction quality consistent across surfaces |
| Category | foundation |
| Lifecycle | Stateless React components, instantiated by features as needed |
| Replaceability | Replaceable per-primitive provided shadcn/Radix prop contract is preserved |

## Purpose

Hosts every shared UI primitive consumed by feature components: buttons, dialogs, popovers, tooltips, selects, scroll areas, kbd. Pure presentational components forwarding typed props to Radix. Non-goals: feature logic, data fetching, app-level state.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | Tailwind theme + shadcn tokens loaded | c3-103 |
| Input — Radix slot APIs | Underlying behavior comes from Radix UI | c3-103 |
| Internal state | Stateless; controlled or uncontrolled per Radix conventions | c3-103 |
| Initialization | Tree-shaken; imports happen lazily per consumer | c3-103 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Visual + interaction consistency across chat, sidebar, settings, terminal | c3-1 |
| Primary path | Feature imports primitive → composes with feature-specific markup | c3-103 |
| Alternate — class merge | cn() helper merges Tailwind classes deterministically | c3-103 |
| Failure — accessibility regression | aria-* attributes lost during refactor | c3-103 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-strong-typing | ref | Typed forwardRef + Props discriminated unions | must follow | No any for HTML attribute spreading |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| <Button> and friends | OUT | Typed forwardRef components with shadcn variants | c3-110 | src/client/components/ui |
| cn(...classes) helper | OUT | Tailwind class merger | c3-110 | src/client/components/ui |
| Variant props | OUT | Discriminated variant + size unions | c3-115 | src/client/components/ui |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Accessibility regression | Slot/asChild rewiring | aXe audit fails or focus traps break | Keyboard nav smoke + bun run check on src/client/components/ui/ |
| Theme drift | Tailwind token rename without sweep | Visual diff in Storybook-style smoke | bun run check + screenshot diff against src/client/components/ui/ |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/client/components/ui/**/*.tsx | c3-103 Contract | New primitives may be added; existing surface stable | src/client/components/ui |
