# Kanna Design-System Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make new component UI strictly follow `DESIGN.md` via a CLAUDE.md guidance rule plus a mechanical ESLint hard gate (`--max-warnings=0`) that bans raw hex, arbitrary hex utilities, glassmorphism blur, and native `title` tooltips.

**Architecture:** Extend the existing `no-restricted-syntax` machinery in `eslint.config.js` (same pattern as the side-effect seal) with a `DESIGN_GATE_SYNTAX` selector array applied to the `src/shared/** + src/client/**` block, plus a `TerminalPane.tsx` chokepoint override that drops only the raw-hex selector. Burn down the small set of existing `backdrop-blur` and native-`title` violations so lint lands green. Document everything in `CLAUDE.md`.

**Tech Stack:** ESLint 9 flat config (`eslint.config.js`), `typescript-eslint`, esquery selectors, Tailwind v4 token classes, Radix Tooltip (`src/client/components/ui/tooltip.tsx`).

## Global Constraints

- Lint command: `bun run lint` (ESLint on `src/`, `--max-warnings=0`). Must end green.
- Typecheck: `bun run typecheck` (TS7 via explicit path). Must stay green.
- Tests: `bun run test` (i.e. `bun test --conditions production`) must pass.
- No `eslint-disable` comments — there is no escape valve (matches the side-effect seal doctrine).
- No new ESLint plugin dependency — pure `no-restricted-syntax`.
- Tint-Everything: `#000`/`#fff` are bugs; use token classes / CSS vars.
- Only sanctioned chokepoint: `src/client/components/chat-ui/TerminalPane.tsx` (xterm `ITheme` needs hex).
- Work happens in worktree `.worktrees/design-system-gate` (branch `design-system-gate`), already created off `origin/main`.
- Commit after each task.

---

### Task 1: Add the green-from-day-one selectors (hex utilities + raw hex) with TerminalPane chokepoint

**Files:**
- Modify: `eslint.config.js` (add `DESIGN_GATE_SYNTAX` + `DESIGN_GATE_SYNTAX_NO_RAW_HEX` consts; extend shared/client block; add TerminalPane override block)

**Interfaces:**
- Produces: two module-level consts `DESIGN_GATE_SYNTAX` (full array) and `DESIGN_GATE_SYNTAX_NO_RAW_HEX` (same minus the two raw-hex selectors), consumed by later tasks that append Rules 3 & 4.

- [ ] **Step 1: Add the selector arrays** near the existing `SHARED_CLIENT_SEAL_SYNTAX` const in `eslint.config.js`:

```js
// Design-system hard gate (DESIGN.md). Rules 3 (backdrop) + 4 (title) are
// appended in their own const below so this stays readable.
const DESIGN_HEX_UTILITY = [
  {
    selector:
      "Literal[value=/(bg|text|border|fill|stroke|ring|shadow|from|to|via|decoration|outline|caret|accent|divide)-\\[#/]",
    message:
      "Arbitrary hex Tailwind utility banned (DESIGN.md). Use a design token class (bg-background, text-foreground, text-destructive, bg-warning, …).",
  },
  {
    selector:
      "TemplateElement[value.raw=/(bg|text|border|fill|stroke|ring|shadow|from|to|via|decoration|outline|caret|accent|divide)-\\[#/]",
    message:
      "Arbitrary hex Tailwind utility banned (DESIGN.md). Use a design token class (bg-background, text-foreground, text-destructive, bg-warning, …).",
  },
]

// Raw hex color literals: 6/8-digit and the pure black/white family.
// 3-digit hex is NOT banned generally (collides with issue refs like "#333"
// inside string literals); only black/white 3-digit forms are listed.
const DESIGN_RAW_HEX = [
  {
    selector: "Literal[value=/#([0-9a-fA-F]{6}([0-9a-fA-F]{2})?|000|fff)\\b/i]",
    message:
      "Raw hex color banned (DESIGN.md Tint-Everything Rule). Use a CSS var / token (var(--background), var(--foreground)) or a Tailwind token class.",
  },
  {
    selector:
      "TemplateElement[value.raw=/#([0-9a-fA-F]{6}([0-9a-fA-F]{2})?|000|fff)\\b/i]",
    message:
      "Raw hex color banned (DESIGN.md Tint-Everything Rule). Use a CSS var / token (var(--background), var(--foreground)) or a Tailwind token class.",
  },
]

// Filled in by later tasks (start empty so Task 1 lands green in isolation).
const DESIGN_BACKDROP = []
const DESIGN_TITLE = []

const DESIGN_GATE_SYNTAX = [
  ...DESIGN_HEX_UTILITY,
  ...DESIGN_RAW_HEX,
  ...DESIGN_BACKDROP,
  ...DESIGN_TITLE,
]
const DESIGN_GATE_SYNTAX_NO_RAW_HEX = [
  ...DESIGN_HEX_UTILITY,
  ...DESIGN_BACKDROP,
  ...DESIGN_TITLE,
]
```

- [ ] **Step 2: Append `DESIGN_GATE_SYNTAX` to the shared/client `no-restricted-syntax`.** In the block `files: ["src/shared/**/*.{ts,tsx}", "src/client/**/*.{ts,tsx}"]`, change:

```js
"no-restricted-syntax": ["error", ...SHARED_CLIENT_SEAL_SYNTAX, ...TYPE_STRICT_SYNTAX],
```
to:
```js
"no-restricted-syntax": [
  "error",
  ...SHARED_CLIENT_SEAL_SYNTAX,
  ...TYPE_STRICT_SYNTAX,
  ...DESIGN_GATE_SYNTAX,
],
```

- [ ] **Step 3: Add the TerminalPane chokepoint override block** AFTER the shared/client block (place it just before the final tests block), re-including the seal + type-strict + design gate MINUS raw hex:

```js
// Sanctioned raw-hex chokepoint: xterm's ITheme takes hex strings, not CSS
// vars. TerminalPane keeps every other design-gate + seal rule.
{
  files: ["src/client/components/chat-ui/TerminalPane.tsx"],
  rules: {
    "no-restricted-syntax": [
      "error",
      ...SHARED_CLIENT_SEAL_SYNTAX,
      ...TYPE_STRICT_SYNTAX,
      ...DESIGN_GATE_SYNTAX_NO_RAW_HEX,
    ],
  },
},
```

- [ ] **Step 4: Run lint — expect GREEN** (Rules 1 & 2 have 0 violations outside the exempted TerminalPane):

Run: `cd .worktrees/design-system-gate && bun run lint`
Expected: exits 0, no errors/warnings.

- [ ] **Step 5: Negative test — confirm Rule 2 fires.** Temporarily append `const _x = "#123456"` to any `src/client/**/*.ts` file (NOT TerminalPane), run lint, confirm it errors with the raw-hex message, then revert:

Run: `bun run lint 2>&1 | grep -i "Raw hex color banned"`
Expected: one match. Then revert the temp edit and re-run lint → green.

- [ ] **Step 6: Negative test — confirm TerminalPane exemption.** Confirm `bun run lint` is green WITH TerminalPane's existing `#0f172a` etc. still present (no edit needed — this is proven by Step 4 already being green).

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js
git commit -m "feat(lint): design-system gate rules 1-2 (hex utilities + raw hex) with TerminalPane chokepoint"
```

---

### Task 2: Add Rule 3 (backdrop-blur ban) and burn down the 7 production uses

**Files:**
- Modify: `eslint.config.js` (fill `DESIGN_BACKDROP`)
- Modify: `src/client/components/chat-ui/ChatNavbar.tsx` (drop `backdrop-blur-lg` ×4)
- Modify: `src/client/app/SettingsPage.tsx:2555` (frosted footer → solid)
- Modify: `src/client/app/share-view/ShareViewPage.tsx:109` (frosted header → solid)
- Modify: `src/client/app/ChatPage/index.tsx:369` (dialog backdrop → dim, no blur)
- Modify: `src/client/components/messages/ExitPlanModeMessage.tsx:193` (hover pill → solid)

**Interfaces:**
- Consumes: `DESIGN_BACKDROP` const from Task 1.

- [ ] **Step 1: Fill `DESIGN_BACKDROP`** in `eslint.config.js`:

```js
const DESIGN_BACKDROP = [
  {
    selector: "Literal[value=/backdrop-(blur|filter)/]",
    message:
      "Glassmorphism banned (DESIGN.md No-Glassmorphism Rule). Use a solid bg-background surface; no backdrop-blur/backdrop-filter.",
  },
  {
    selector: "TemplateElement[value.raw=/backdrop-(blur|filter)/]",
    message:
      "Glassmorphism banned (DESIGN.md No-Glassmorphism Rule). Use a solid bg-background surface; no backdrop-blur/backdrop-filter.",
  },
]
```

- [ ] **Step 2: Run lint — expect RED** with 7 backdrop errors (the 7 production sites). This is the failing test.

Run: `bun run lint 2>&1 | grep -c "Glassmorphism banned"`
Expected: 7.

- [ ] **Step 3: Burn down ChatNavbar.tsx (×4).** Remove the ` backdrop-blur-lg` token from each of the four pill container classNames (lines ~159, ~249, ~256, ~268). Example for line 249:

```tsx
// before
<div className="flex items-center flex-shrink-0 border border-border rounded-2xl backdrop-blur-lg">
// after
<div className="flex items-center flex-shrink-0 border border-border rounded-2xl">
```
Apply the same deletion to lines 159 (inside the template literal), 256, 268.

- [ ] **Step 4: Burn down SettingsPage.tsx:2555.** Replace the frosted footer classes:

```tsx
// before
<div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
// after
<div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background">
```

- [ ] **Step 5: Burn down ShareViewPage.tsx:109.**

```tsx
// before
<header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
// after
<header className="sticky top-0 z-10 border-b border-border bg-background">
```

- [ ] **Step 6: Burn down ChatPage/index.tsx:369** (keep the dim layer, drop the blur):

```tsx
// before
className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
// after
className="absolute inset-0 bg-black/45"
```

- [ ] **Step 7: Burn down ExitPlanModeMessage.tsx:193** (floating pill → solid surface for legibility). Remove `backdrop-blur-sm` and add `bg-background`:

```tsx
// change the className fragment
//   ... text-muted-foreground backdrop-blur-sm hover:text-foreground ...
// to
//   ... text-muted-foreground bg-background hover:text-foreground ...
```

- [ ] **Step 8: Run lint — expect GREEN**

Run: `bun run lint`
Expected: exits 0.

- [ ] **Step 9: UI smoke check.** Start dev server, verify navbar pills, settings footer, share header, plan-hover pill, and dialog backdrop still render correctly (solid, legible, no visual regression). Note if the dev server can't be started in this environment.

- [ ] **Step 10: Commit**

```bash
git add eslint.config.js src/client/components/chat-ui/ChatNavbar.tsx src/client/app/SettingsPage.tsx src/client/app/share-view/ShareViewPage.tsx src/client/app/ChatPage/index.tsx src/client/components/messages/ExitPlanModeMessage.tsx
git commit -m "feat(lint): design-system gate rule 3 (ban glassmorphism blur) + burn down 7 sites"
```

---

### Task 3: Add Rule 4 (native `title` on intrinsic elements) and burn down flagged sites

**Files:**
- Modify: `eslint.config.js` (fill `DESIGN_TITLE`)
- Modify: `src/client/app/SettingsPage.tsx:1739-1747` (button `title` → Tooltip)
- Modify: any additional intrinsic-`title` sites surfaced by the first lint run.

**Interfaces:**
- Consumes: `DESIGN_TITLE` const from Task 1; Tooltip components from `src/client/components/ui/tooltip.tsx` (`Tooltip`, `TooltipTrigger`, `TooltipContent`).

- [ ] **Step 1: Fill `DESIGN_TITLE`** in `eslint.config.js` (esquery matches the intrinsic tag by lowercase-initial regex, so PascalCase component props named `title` are NOT flagged):

```js
const DESIGN_TITLE = [
  {
    selector:
      "JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name='title']",
    message:
      "Native `title` tooltip banned (DESIGN.md). Use the project Tooltip component (src/client/components/ui/tooltip.tsx) as the hover-explanation surface.",
  },
]
```

- [ ] **Step 2: Run lint — expect RED.** Capture the exact flagged sites (the burn-down set):

Run: `bun run lint 2>&1 | grep -B2 "Native .title. tooltip banned"`
Expected: ≥1 site, including `SettingsPage.tsx` around line 1744.

- [ ] **Step 3: Convert SettingsPage.tsx open-sidebar button to Tooltip.** Ensure `Tooltip, TooltipTrigger, TooltipContent` are imported from `../components/ui/tooltip` (add to the existing import if missing). Replace the button:

```tsx
// before
<button
  type="button"
  onClick={state.openSidebar}
  className="flex shrink-0 items-center p-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
  aria-label="Open sidebar"
  title="Open sidebar"
>
  <Menu className="h-4 w-4 shrink-0" />
</button>
// after
<Tooltip>
  <TooltipTrigger asChild>
    <button
      type="button"
      onClick={state.openSidebar}
      className="flex shrink-0 items-center p-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      aria-label="Open sidebar"
    >
      <Menu className="h-4 w-4 shrink-0" />
    </button>
  </TooltipTrigger>
  <TooltipContent>Open sidebar</TooltipContent>
</Tooltip>
```
(A `TooltipProvider` already wraps the app; if lint/runtime complains about a missing provider, wrap locally with `TooltipProvider`.)

- [ ] **Step 4: Convert every other flagged site the same way.** For each site from Step 2: if a hover hint is wanted, wrap the intrinsic element with `Tooltip`/`TooltipTrigger asChild`/`TooltipContent` and move the text into `TooltipContent`, dropping the `title` attribute. If the element already has an `aria-label` and no visible hover hint is needed, simply delete the `title` attribute. Do NOT touch component props named `title` (they are not flagged).

- [ ] **Step 5: Run lint — expect GREEN**

Run: `bun run lint`
Expected: exits 0.

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: exits 0 (Tooltip wrapping is type-safe; no `any`/`as` introduced).

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js src/client/app/SettingsPage.tsx
# plus any other files edited in Step 4
git commit -m "feat(lint): design-system gate rule 4 (ban native title tooltip) + convert sites to Tooltip"
```

---

### Task 4: Document the gate in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (new `# Design System (MANDATORY)` section, placed right after the `# Side-Effect Lint (ports-and-adapters seal)` section it parallels)

- [ ] **Step 1: Insert the section:**

```markdown
# Design System (MANDATORY)

`DESIGN.md` (repo root) is the single source of truth for Kanna's visual
system — the warm rose-tinted OKLCH palette (hue ~13°), the Body / Bricolage
Grotesque / Roboto Mono type pairing, and all named rules. Live tokens are
defined in `src/index.css` and consumed as Tailwind theme vars
(`bg-background`, `text-foreground`, `text-destructive`, `bg-warning`, …).
**Load `DESIGN.md` before any `src/client/**` UI work.**

**Hard gate (enforced, `bun run lint --max-warnings=0`).** `eslint.config.js`
`DESIGN_GATE_SYNTAX` bans in `src/shared/** + src/client/**`:
1. Arbitrary hex Tailwind utilities (`bg-[#…]`, `text-[#…]`, …) — use token classes.
2. Raw hex color literals (6/8-digit + `#000`/`#fff` family) — use CSS vars / tokens.
   3-digit hex is not banned generally (collides with `#333`-style refs); only
   the black/white forms are.
3. `backdrop-blur` / `backdrop-filter` (No-Glassmorphism Rule) — use solid `bg-background`.
4. Native `title` on intrinsic elements — use the project `Tooltip` component.

**Sanctioned chokepoint:** `src/client/components/chat-ui/TerminalPane.tsx` is
exempt from Rule 2 only (xterm's `ITheme` API takes hex strings, not CSS vars).
No other exemptions; no `eslint-disable`.

**Guidance-only (NOT linted — semantic, would false-positive).** Follow these
by hand; they are not mechanically enforced:
- No pulse/glow on status **dots** (`animate-pulse` is fine for skeletons/typeaheads).
- Kanna Coral on ≤10% of a screen; brand mark + destructive intent only.
- `tabular-nums` on every duration / count / age / pid / live ticker.
- Flat by default; depth via contrast + 1px soft edge, not shadow.
- Pair color with icon / label / weight; color alone never communicates.
```

- [ ] **Step 2: Lint stays green** (docs-only change, but run to be safe):

Run: `bun run lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document design-system hard gate + guidance-only rules"
```

---

### Task 5: Full verification + finish branch

- [ ] **Step 1: Full lint + typecheck + tests**

Run: `bun run lint && bun run typecheck && bun run test`
Expected: all exit 0. (If `bun run test` is too slow/heavy here, at minimum run lint + typecheck green and note test status.)

- [ ] **Step 2: Re-confirm all four rules fire** via a scratch file with one violation each (`bg-[#fff]`, `"#abcdef"`, `backdrop-blur`, `<div title="x">`); confirm 4 distinct messages; delete the scratch file.

- [ ] **Step 3: Finish the branch** using superpowers:finishing-a-development-branch (merge locally to main, or push + PR against `cuongtranba/kanna` per CLAUDE.md). Ask the user which they prefer.
