---
id: adr-20260521-notice-banner-extract
c3-seal: 1fb7be75fe8e25ef33f49b300823d1275554ebecb1d9cf488a7ad97fda365e81
title: notice-banner-extract
type: adr
goal: Replace the inline PTY-driver banner in `src/client/app/App.tsx` with a generic, variant-driven `NoticeBanner` primitive under `src/client/components/ui/`. The primitive must accept a `variant` (`warning | info | error | success`) and arbitrary message content, so future top-of-shell notices (new Kanna update available, GitHub CI status failure, OAuth-pool exhausted, etc.) can be added without re-deriving banner markup.
status: proposed
date: "2026-05-21"
---

# Extract NoticeBanner UI primitive

## Goal

Replace the inline PTY-driver banner in `src/client/app/App.tsx` with a generic, variant-driven `NoticeBanner` primitive under `src/client/components/ui/`. The primitive must accept a `variant` (`warning | info | error | success`) and arbitrary message content, so future top-of-shell notices (new Kanna update available, GitHub CI status failure, OAuth-pool exhausted, etc.) can be added without re-deriving banner markup.

## Context

App.tsx currently inlines a 15-line JSX block (lines 437–452) for the "PTY driver active" notice. The block hard-codes the dot color (`var(--warning)`), background tint (`bg-warning/[0.06]`), and layout classes. There is no reusable banner primitive in `src/client/components/ui/`. The shell will soon need to surface additional notices (update detector via `c3-219 update-manager`, CI status, OAuth alerts). Copy-pasting the inline block per notice would diverge tone, spacing, and a11y attrs and would scatter the rule-of-thumb (one notice strip at the top of the shell). Topology affected: `c3-103 ui-primitives` gains a new primitive; `c3-110 app-shell` switches from inline JSX to composition.

## Decision

Add `NoticeBanner` to `src/client/components/ui/notice-banner.tsx`. Props: `variant: "warning" | "info" | "error" | "success"`, `children: ReactNode`, optional `className`, optional `dot?: boolean` (default true). The primitive renders a flex strip with role="status", a tone-colored dot, and the children — preserving the current PTY-banner layout. Variant maps to a `--<tone>` CSS variable for the dot and a `bg-<tone>/[0.06]` background tint via a single lookup table. `App.tsx` composes the primitive: `<NoticeBanner variant="warning"><strong>PTY driver active.</strong> Tools run under the claude CLI ...</NoticeBanner>`. This fits c3-103 (low-level brand-aligned primitive) and keeps c3-110 in composition mode, matching the existing `<Button>` / `<Tooltip>` pattern.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-103 | component | Gains new primitive NoticeBanner under src/client/components/ui/notice-banner.tsx | Derived Materials row stays "src/client/components/ui/**/*.tsx" — no signature change |
| c3-110 | component | Inline PTY banner removed; composes NoticeBanner instead | Contract / Derived Materials unchanged; App.tsx still owns the conditional render |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | Variant union must be a discriminated string literal type, no any for ReactNode children spread | comply |
| ref-cqrs-read-models | Cited by c3-110 (consumer of NoticeBanner); banner is presentational only and does not read events, but c3-110's CQRS contract is unaffected | review (no change required) |
| ref-ws-subscription | Cited by c3-110 (consumer); NoticeBanner has no WS coupling so the single-socket subscription contract is preserved | review (no change required) |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | Variant + props typed concretely; no any for HTML attribute spreading | comply |
| rule-colocated-bun-test | New primitive must ship with notice-banner.test.tsx next to it | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Primitive | Add src/client/components/ui/notice-banner.tsx with typed NoticeBannerProps and variant tone table | src/client/components/ui/notice-banner.tsx |
| Test | Add src/client/components/ui/notice-banner.test.tsx covering each variant and role="status" attr | src/client/components/ui/notice-banner.test.tsx |
| Wire | Replace PTY-banner JSX block in App.tsx (lines 437–452) with <NoticeBanner variant="warning">...</NoticeBanner> | src/client/app/App.tsx |
| Lint/test | bun run lint and bun test src/client/components/ui/notice-banner.test.tsx must pass | CI |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI / validator / schema change | N.A - this ADR adds a UI primitive only; no .c3/ CLI surface modified | N.A - no underlay surface touched |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| TypeScript compiler | bunx tsc --noEmit catches any consumer that passes an unknown variant | tsc run in CI |
| ESLint (--max-warnings=0) | Rejects any / hook misuse in the new primitive | bun run lint in CI |
| Bun test | notice-banner.test.tsx asserts each variant renders the right tone class + role="status" | bun test src/client/components/ui |
| c3x check | Verifies c3-103 Derived Materials glob still matches the new file path | c3x check --only c3-103 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep banner inline in App.tsx; copy-paste for each future notice | Defeats the user's stated goal of one place to add notices; tone drift inevitable |
| Build a full notification-stack component (toast + banner + modal) | Out of scope for this change; only the top-of-shell banner is required now; YAGNI per project rules |
| Put banner under src/client/components/chat-ui/ | chat-ui (c3-115) is scoped to composer/chrome; banner is shell-wide, fits ui-primitives (c3-103) |
| Use shadcn Alert directly without a wrapper | shadcn Alert is not present in this repo's primitive set today; adding our own narrower primitive matches existing kbd/tooltip pattern |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Variant tone class typo silently falls back to no background | Map variants via const record; tsc proves exhaustiveness | bunx tsc --noEmit |
| Banner breaks a11y if role/aria attrs dropped | Hard-code role="status"; test asserts presence | notice-banner.test.tsx |
| Future consumers nest interactive content; banner role="status" announces children | Document children type as inline message text only; recommend separate Alert primitive for actionable notices | ADR follow-up tracked here |

## Verification

| Check | Result |
| --- | --- |
| bun run lint | 0 errors, warnings <= existing cap |
| bun test src/client/components/ui/notice-banner.test.tsx | All variant tests pass |
| bunx tsc --noEmit | Type-clean |
| Manual smoke: toggle KANNA_CLAUDE_DRIVER=pty, load app, confirm banner renders with warning tone | Banner visible above shell content; same look as before |
| C3X_MODE=agent c3x check --only c3-103,c3-110 | Pass |
