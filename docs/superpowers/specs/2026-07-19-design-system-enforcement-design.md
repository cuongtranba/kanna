# Design: Kanna Design-System Enforcement

Date: 2026-07-19
Status: approved-direction (maximal gate + burn-down)

## Problem

`DESIGN.md` is the authoritative Kanna design spec, but nothing prevents new
component UI from drifting off-pattern (raw hex colors, glassmorphism blur,
native `title` tooltips). We want new UI to strictly follow the pattern via
(A) a CLAUDE.md rule for agent guidance and (B) a mechanical hard gate that
blocks merges — mirroring the existing side-effect seal.

## Source of truth

`DESIGN.md` (repo root) stays the single source of truth for tokens and named
rules. `src/index.css` holds the live OKLCH token definitions consumed as
Tailwind theme vars (`bg-background`, `text-foreground`, `text-destructive`,
`bg-warning`, …). This spec adds enforcement; it does not restate tokens.

## Part A — CLAUDE.md rule (guidance)

Add a new `# Design System (MANDATORY)` section to the project `CLAUDE.md`
(next to the "Side-Effect Lint" section it parallels). It states:

- `DESIGN.md` is authoritative; load it before any `src/client/**` UI work.
- Use Tailwind token classes, never raw hex or arbitrary color values.
- The four lint-enforced rules (Part B) and the `TerminalPane` chokepoint.
- The **semantic rules that remain guidance-only** because they cannot be
  linted without false positives:
  - No pulse/glow on status **dots** (`animate-pulse` is fine for skeletons).
  - Kanna Coral on ≤10% of a screen; brand mark + destructive intent only.
  - `tabular-nums` on every duration/count/age/pid/ticker.
  - Flat by default; depth via contrast + 1px soft edge, not shadow.
  - Pair color with icon/label/weight; color alone never communicates.

## Part B — Hard gate (mechanical, `--max-warnings=0`)

All rules added to `eslint.config.js`. Styling/JSX lives in `src/client/**`;
raw color constants could appear in `src/shared/**` too, so the value-literal
rules attach to the existing `src/shared/** + src/client/**` block. A new
`DESIGN_GATE_SYNTAX` array is appended to that block's `no-restricted-syntax`
(alongside `SHARED_CLIENT_SEAL_SYNTAX` + `TYPE_STRICT_SYNTAX`).

### Rule 1 — Ban arbitrary Tailwind hex utilities

Match string / template literals whose value contains an arbitrary hex color
utility:

```
(bg|text|border|fill|stroke|ring|shadow|from|to|via|decoration|outline|caret|accent|divide)-\[#
```

Selectors: `Literal[value=/.../]` and `TemplateElement[value.raw=/.../]`.
Current violations: **0**. Message: use a token class (`bg-background`,
`text-foreground`, …), not an arbitrary hex.

### Rule 2 — Ban raw hex color literals

Match 6- and 8-digit hex (`#rrggbb`, `#rrggbbaa`) and the pure black/white
family (`#000`, `#fff`, `#000000`, `#ffffff`, case-insensitive). 3-digit hex
in general is intentionally NOT banned because it collides with issue/PR text
like `#333` inside string literals (e.g. `linkifyTextRefs.ts`); only the
black/white 3-digit forms are listed explicitly.

Regex (two selectors, Literal + TemplateElement):
`#([0-9a-fA-F]{6}([0-9a-fA-F]{2})?|000|fff|FFF)\b` plus the 3-digit black/white
forms. Comments are invisible to `no-restricted-syntax`, so `// issue #215`
never trips.

Current violations: **all in `TerminalPane.tsx`** (the xterm ANSI 16-color
theme + `readCssVar` fallbacks). xterm's `ITheme` API takes hex strings, not
CSS vars — this is a legitimate external-API boundary. Message: Tint-Everything
Rule — use `--background`/`--foreground` tokens, not raw hex.

### Rule 3 — Ban glassmorphism blur

Match string / template literals containing `backdrop-blur` or
`backdrop-filter`. Selectors: Literal + TemplateElement.

Burn-down (7 production uses → convert to solid per DESIGN.md
No-Glassmorphism Rule):
- `ChatNavbar.tsx` ×4 — navbar pill containers → drop `backdrop-blur-lg`
  (navbar is flat + 1px border by spec).
- `SettingsPage.tsx:2555`, `ShareViewPage.tsx:109` — frosted sticky bars →
  solid `bg-background` (drop `backdrop-blur` + `supports-[backdrop-filter]`).
- `ChatPage/index.tsx:369` — dialog backdrop → keep dim layer, drop
  `backdrop-blur-[1px]` (spec: dim layer, no blur).
- `ExitPlanModeMessage.tsx:193` — floating hover button over the plan diff →
  convert to solid `bg-background` for consistency (evaluate the functional
  media-overlay exception during implementation; document inline if kept).

No blanket exemption. The `OfferDownloadMessage.test.tsx` occurrence is a test
assertion (already in the exempt test glob).

### Rule 4 — Ban native `title` on intrinsic elements

Selector (esquery matches the intrinsic tag name by regex, so PascalCase
component props named `title` are NOT flagged):

```
JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']
```

Burn-down: the few genuine native usages (e.g. `<button title="Open sidebar">`
in `SettingsPage.tsx:1744`) → replace with the project `Tooltip` component per
DESIGN.md ("native `title` prohibited as a hover-explanation surface"). The
93-count `title=` grep is dominated by component props (`<SettingsRow>`,
`<Card>`) which this selector ignores. Exact count confirmed on first lint run.

## Exemptions (documented chokepoints)

Follow the existing `log.ts` / `errors.ts` override pattern. Add a
`TerminalPane.tsx` override block AFTER the shared/client block that
re-includes `SHARED_CLIENT_SEAL_SYNTAX` + `TYPE_STRICT_SYNTAX` + Rules 1/3/4
but DROPS Rule 2 (raw hex), because the xterm theme needs hex. No other
exemptions.

## Non-goals

- No burn-down of `animate-pulse` (semantic — dots only; guidance in CLAUDE.md).
- No ≤10%-coral or tabular-nums linting (not mechanically decidable).
- No changes to `DESIGN.md` tokens or `src/index.css`.
- No new ESLint plugin dependency — pure `no-restricted-syntax`.

## Verification

- `bun run lint` stays green (0 warnings) after the gate + burn-down land.
- `bun run typecheck` green (no type impact expected).
- Manual: negative test — temporarily add `bg-[#123456]` and a
  `<div title="x">` to confirm each rule fires; revert.
- UI smoke: navbar, settings footer, share header, plan hover button, and the
  dialog backdrop still render correctly after blur removal.

## Files touched

- `CLAUDE.md` — new Design System section.
- `eslint.config.js` — `DESIGN_GATE_SYNTAX` + TerminalPane override.
- `src/client/components/chat-ui/ChatNavbar.tsx` — drop blur ×4.
- `src/client/app/SettingsPage.tsx` — drop blur; convert native `title`.
- `src/client/app/share-view/ShareViewPage.tsx` — drop blur.
- `src/client/app/ChatPage/index.tsx` — drop backdrop blur.
- `src/client/components/messages/ExitPlanModeMessage.tsx` — drop blur.
- Any other intrinsic-`title` sites surfaced by the first lint run.
