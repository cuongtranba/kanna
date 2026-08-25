---
name: Kanna
description: A calm, editorial web UI for the Claude Code & Codex CLIs.
colors:
  paper: "oklch(99.5% 0.003 13)"
  inkstone: "oklch(20% 0.01 13)"
  espresso-ink: "oklch(16% 0.01 13)"
  pale-foreground: "oklch(98% 0.003 13)"
  warm-card-light: "oklch(99.5% 0.003 13)"
  warm-card-dark: "oklch(23% 0.01 13)"
  surface-secondary-light: "oklch(96% 0.005 13)"
  surface-secondary-dark: "oklch(26% 0.01 13)"
  margin-gray-light: "oklch(46% 0.013 13)"
  margin-gray-dark: "oklch(72% 0.012 13)"
  soft-edge-light: "oklch(91% 0.008 13)"
  soft-edge-dark: "oklch(29% 0.008 13)"
  muted-icon-light: "oklch(82% 0.008 13)"
  muted-icon-dark: "oklch(55% 0.01 13)"
  kanna-coral: "oklch(71.2% 0.194 13.428)"
  destructive-text: "oklch(56% 0.18 13)"
  verified-sage: "oklch(68% 0.15 155)"
  editor-amber: "oklch(76% 0.14 78)"
  reference-blue: "oklch(66% 0.13 235)"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, Bricolage Grotesque, sans-serif"
    fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Body, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Body, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "Body, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Body, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.005em"
  mono:
    fontFamily: "Roboto Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "tnum"
rounded:
  sm: "calc(0.5rem - 4px)"
  md: "calc(0.5rem - 2px)"
  lg: "0.5rem"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
components:
  button-primary:
    backgroundColor: "{colors.espresso-ink}"
    textColor: "{colors.pale-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-secondary:
    backgroundColor: "{colors.surface-secondary-light}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  button-destructive:
    backgroundColor: "{colors.kanna-coral}"
    textColor: "{colors.pale-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
  card-surface:
    backgroundColor: "{colors.warm-card-light}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  dialog-surface:
    backgroundColor: "{colors.warm-card-light}"
    textColor: "{colors.espresso-ink}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Kanna

## 1. Overview

**Creative North Star: "The Editorial Workspace"**

Kanna reads like a well-edited document, not a dashboard. The system stays warm-tinted and quiet so that long agent sessions remain legible at 11pm on a 27-inch monitor without wearing the user down. Density is paid for in rhythm, not in chrome: hierarchy emerges from typographic weight and generous spacing, never from gradients, glow, or decorative borders. The palette tints every neutral toward a warm rose hue (~13°) so even greys feel like paper, not aluminium. The system explicitly rejects the four anti-references in PRODUCT.md: generic AI SaaS gradient chrome, marketing-heavy SaaS-cream landing pages, neon terminal cyberpunk, and cluttered dashboard density.

Color is restrained by default. One brand accent (Kanna Coral) carries identity and destructive intent both, used on under 10% of any screen. Three semantic accents (sage, amber, blue) carry success/warning/info — never decorative. State is always paired with a label or icon shape; color alone never communicates.

**Key Characteristics:**

- Warm-tinted neutrals (chroma 0.003–0.013, hue ~13°) across both themes.
- One brand accent, used rarely and on purpose.
- Editorial type pairing: Body (a custom warm sans) for prose; Bricolage Grotesque for the logo only; Roboto Mono for code, IDs, and tabular data.
- Flat by default. Depth comes from contrast and spacing, not shadows.
- Tabular numerics on every duration, count, age, or pid. No reflow under live tickers.

## 2. Colors: The Warm Editorial Palette

The palette is one rose-tinted neutral family with a single saturated coral accent and three semantic markers. Every color is OKLCH; the doctrine is "tint everything, even white."

### Primary

- **Kanna Coral** (`oklch(71.2% 0.194 13.428)`): the brand mark and the destructive surface. Used as logo color, as the primary CTA in landing/auth contexts, and as `--destructive` for stop/delete affordances. Never used as a background fill or a decorative gradient stop.

- **Destructive Text** (`oklch(56% 0.18 13)` light / `oklch(78% 0.18 13)` dark): AA-compliant coral for text and icon-only destructive contexts on tinted surfaces (e.g. "Confirm stop?", "Force kill" labels, the failed-pill in CronRunMessage). The bright Kanna Coral (`oklch(71.2% 0.194 13.428)`) achieves only 2.81:1 on Warm Paper in light mode and 3.94:1 on a `bg-destructive/10` over Warm Card Dark — both below WCAG AA. The light variant hits 5.04:1 on Warm Paper. The dark variant at L=78% achieves 4.76:1 on `bg-destructive/10` over Warm Card Dark and 7.56:1 on Inkstone. Filled destructive buttons continue to use the bright coral as background with Pale Foreground text — this token is only for text or icon-only use on tinted or light surfaces.

- **Destructive Filled** (`oklch(48% 0.16 13)` light / `oklch(68% 0.16 13)` dark): the dedicated filled-action surface, paired with Pale Foreground in light mode and Espresso Ink in dark mode. The `action/destructive-filled` catalog entry machine-checks the complete pair at WCAG AA in both themes; filled destructive controls never reuse the brighter logo coral.

- **Overlay** (`oklch(20% 0.01 13)` light / `oklch(12% 0.008 13)` dark): warm ink behind dialogs and mobile navigation. Use at 50% for modal dialogs and 40% for mobile navigation; raw black overlays are prohibited.

- **Success Text** (`oklch(37% 0.1 155)` light / `oklch(76% 0.14 155)` dark): AA-compliant sage for text-only success contexts on tinted surfaces (completed-pill). Dark value brightened beyond `--success` (oklch 72%) to achieve 5.14:1 on `bg-success/10` over Warm Card Dark.

- **Warning Text** (`oklch(42% 0.09 78)` light / `oklch(80% 0.13 78)` dark): AA-compliant amber for text-only running/warning contexts on tinted surfaces (running-pill). Dark aliases `--warning` (oklch 80% 0.13 78), which achieves 4.98:1 on `bg-warning/10` over Warm Card Dark.

- **Info Text** (`oklch(38% 0.09 235)` light / `oklch(72% 0.12 235)` dark): AA-compliant blue for text-only info contexts on tinted surfaces. Dark aliases `--info`.

### Semantic Tint Pairings

Tinted pill surfaces (`bg-{color}/10`) require pairing with a **`-text`** token, not the raw color or `-foreground`. Raw colors like `--success` (sage green) achieve only 4.46:1 on a `bg-success/10` over Warm Card Dark — below WCAG AA. The `-foreground` tokens (e.g. `--warning-foreground: oklch(25% 0.03 78)`) are near-black in light and near-black in dark — 1.30:1 on a dark tinted surface.

The complete catalog lives in `src/shared/design/tone-pairings.ts` (`TONE_PAIRINGS`, `STATUS_PILL_CLASS`). Every entry is machine-checked in `src/server/design/tone-pairings.test.ts` — WCAG AA (4.5:1) in both themes, compositing `bg-{color}/{alpha}` over the real base surface.

**Contrast gate (enforced, two layers):**
1. `bun run lint:usestate` (ast-grep, `rules/no-inline-tint-pairing.yml`): bans inline `text-{color}[-foreground]` + `bg-{color}/` class pairs in `src/client/**`. Use `STATUS_PILL_CLASS[status]` from the catalog instead.
2. `bun run test src/server/design/tone-pairings.test.ts`: asserts ≥4.5:1 for every `TONE_PAIRINGS` entry × {light, dark}.

Adding a new semantic tint context requires: (a) adding an entry to `TONE_PAIRINGS`, (b) choosing `-text` tokens whose contrast the test confirms, (c) adding a corresponding `STATUS_PILL_CLASS` key if it is a status pill.

### Neutral (warm rose family, hue ~13°)

- **Warm Paper** (`oklch(99.5% 0.003 13)`): light-mode background. Tinted just enough to feel paper-like rather than clinical.
- **Inkstone** (`oklch(20% 0.01 13)`): dark-mode background. Warm enough to read as ink rather than asphalt.
- **Espresso Ink** (`oklch(16% 0.01 13)`): light-mode foreground; primary fill in dark-mode buttons.
- **Pale Foreground** (`oklch(98% 0.003 13)`): dark-mode foreground; readable on Inkstone.
- **Margin Gray** (`oklch(46% 0.013 13)` light / `oklch(72% 0.012 13)` dark): muted text — timestamps, secondary metadata, and system messages. Both theme values meet the 7:1 editorial body-text target on the page background.
- **Soft Edge** (`oklch(91% 0.008 13)` light / `oklch(29% 0.008 13)` dark): borders and dividers. Always 1px, never wider; never colored.
- **Muted Icon** (`oklch(82% 0.008 13)` light / `oklch(55% 0.01 13)` dark): icon-only fills when the icon is informational, not actionable.
- **Surface Secondary** (`oklch(96% 0.005 13)` light / `oklch(26% 0.01 13)` dark): tonal layer for secondary buttons, hover states, muted panels.
- **Warm Card** (`oklch(99.5% 0.003 13)` light / `oklch(23% 0.01 13)` dark): elevated surfaces (cards, dialogs, popovers). One step warmer than the page in dark mode to give tonal lift without a shadow.

### Semantic

- **Verified Sage** (`oklch(68% 0.15 155)`): success — completed tasks, applied diffs, healthy state. Pair with check shape.
- **Editor Amber** (`oklch(76% 0.14 78)`): warning and *running* state. Used for live agent indicators and background-task running dots. Never alarms, never congratulates; states *attention available*. Pair with text or icon.
- **Reference Blue** (`oklch(66% 0.13 235)`): informational — links, references, neutral notices. Pair with underline or icon.

### Named Rules

**The Tint-Everything Rule.** No `#000` or `#fff`. Every neutral carries chroma 0.003–0.013 toward hue 13°. Pure black or pure white in this codebase is a bug.

**The One-Voice Rule.** Kanna Coral is the only brand color and is used on ≤10% of any given screen. Its rarity is the point. Decorative use prohibited.

**The Color-Plus Rule.** Color alone never carries meaning. Status, errors, and live states always pair color with shape (icon), text, or weight, so the interface remains legible to users with reduced color vision and to anyone glancing past a screen.

## 3. Typography

**Display Font:** Bricolage Grotesque Variable (Bricolage Grotesque fallback, sans-serif). Used **only** for the Kanna wordmark. Not for headings.

**Body Font:** Body — a self-hosted warm humanist sans served from `/fonts/body-*.woff2` at weights 400, 500, 600. Fallback stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Body is the workhorse: chat content, sidebar, dialogs, settings, every label that is not code.

**Label/Mono Font:** Roboto Mono. Used for code, command names, ids, durations, ages, pids, and any column that benefits from `font-variant-numeric: tabular-nums`.

**Character:** Body reads warmer and less industrial than Inter or system-default. Roboto Mono is geometric without being playful. Together they sit close to a serious editorial publication that happens to render code, not a terminal that grew a UI.

### Hierarchy

- **Display** (Bricolage Grotesque, 800, `clamp(1.75rem, 3.5vw, 2.5rem)`, line-height 1.05, letter-spacing -0.02em): the Kanna wordmark only.
- **Headline** (Body, 500, 1.125rem / 18px, line-height 1.3, letter-spacing -0.01em): page titles, dialog titles, section headers. Sentence case, no all-caps, no icon prefix on dialog titles.
- **Title** (Body, 600, 0.9375rem / 15px, line-height 1.35): chat list rows, sidebar group labels, primary command names in lists.
- **Body** (Body, 400, 0.875rem / 14px, line-height 1.55): chat content, prose, descriptive metadata. Cap line length at 65–75ch in long-form contexts.
- **Label** (Body, 500, 0.75rem / 12px, line-height 1.3): metadata pairs, timestamps, type tags, secondary annotations.
- **Mono** (Roboto Mono, 400, 0.8125rem / 13px, line-height 1.55, `tabular-nums`): commands, durations, ages, pids, anything monospaced or numeric.

### Named Rules

**The No-All-Caps Rule.** Headers and labels are sentence case. ALL CAPS is reserved for emergencies the system does not have.

**The Tabular-Nums Rule.** Any duration, count, age, pid, or time-to-x ticker uses `font-variant-numeric: tabular-nums`. Reflow under live tickers is a regression.

**The Mobile-Input-16 Rule.** Inputs, textareas, and selects use `font-size: 16px` minimum on mobile to prevent iOS zoom-on-focus. Carried at the global stylesheet level; do not override.

## 4. Elevation

Kanna is **flat by default with tonal layering for depth**. There is no global shadow vocabulary. In light mode, the page and elevated surfaces share the same lightness; depth comes from a 1px border and from the warm-card hue being identical. In dark mode, elevated surfaces (cards, popovers, dialogs) shift one step lighter than the background (Inkstone → Warm Card Dark) so they lift without a glow.

Shadows appear only as a response to *state*: focus rings, dialog overlays, and the toaster. Even those are restrained — no halo, no spread larger than 4px.

### Shadow Vocabulary

- **Focus ring** (`outline: 2px solid var(--ring)` with 2px offset): keyboard focus only. Visible always; `outline: none` without a replacement is prohibited.
- **Dialog backdrop** (default shadcn dialog overlay, no blur): a single dimming layer at ~50% black-tinted-warm. **No backdrop-filter blur.**
- **Toaster** (default sonner shadow): the only floating element with a soft shadow. Bottom-right desktop, top-center mobile.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Depth is a state response (focus, overlay), not an idle aesthetic.

**The No-Glassmorphism Rule.** `backdrop-filter: blur(...)` on a translucent panel is prohibited as a default. Use it only when the underlying content must stay partially visible for a functional reason (e.g. media overlay).

## 5. Components

### Buttons

- **Shape:** rounded corners (`rounded-md`, ~6px). Never pill, never sharp.
- **Primary:** Espresso Ink fill, Pale Foreground text, 8×14 padding. Hover steps to slightly lighter ink.
- **Secondary:** Surface Secondary fill, Espresso Ink text. Used for non-destructive secondary actions.
- **Ghost:** transparent fill, Espresso Ink text. Used inside dense lists where another fill would be noise.
- **Destructive:** Kanna Coral fill, Pale Foreground text. Reserved for stop, delete, force-kill. Pairs with confirm-step inline; never opens a modal-on-modal.
- **Hover / Focus:** color transitions in 150ms ease-out. Focus ring (2px solid Ring) on `:focus-visible`. Active state slightly compresses background luminance, no transform.

### Inputs / Fields

- **Style:** Paper background, Soft Edge 1px border, `rounded-md`, 8×12 padding.
- **Focus:** border shifts to Ring color; subtle 1px focus ring outside the border, no glow.
- **Error:** border shifts to Kanna Coral, helper text in Coral with icon prefix.
- **Mobile:** font-size 16px enforced globally to prevent iOS zoom.

### Cards / Surfaces

- **Corner Style:** `rounded-lg` (8px).
- **Background:** Warm Card (light or dark variant) — same hue as page in light, one step lighter in dark.
- **Shadow Strategy:** none at rest; depth via background hue + 1px Soft Edge border in light mode.
- **Border:** 1px Soft Edge in light mode; borderless in dark mode (tonal lift carries it).
- **Internal Padding:** 16px default; 24px for dialog surfaces.

### Dialogs / Popovers / Sheets

- **Surface:** Warm Card with `rounded-lg`, 24px padding for dialogs, 12–16px for popovers.
- **Title:** Headline scale, sentence case, no icon prefix.
- **Backdrop:** dim layer, no blur.
- **Open animation:** scale 0.98 → 1, opacity 0 → 1, 160ms ease-out-quart. Disabled under `prefers-reduced-motion`.
- **Mobile:** dialogs become bottom sheets, full width, swipe-down to dismiss.

### Navigation (Sidebar + ChatNavbar)

- **Sidebar:** Surface Secondary background, Title-scale group labels, Body-scale chat rows, status indicator dot at start of row (sage / amber / coral / muted, pair with shape variation). Drag-and-drop project ordering via clear handle, never a hidden affordance.
- **Navbar:** flat, 1px Soft Edge bottom border, Body-scale title centered, action icon group right-aligned. Tooltips use the project `Tooltip` component, **never** native `title`.
- **Active state:** background shifts to Surface Secondary, label weight steps up to Title (600). No left-border stripe.

### Lists (chat transcripts, sidebar, background tasks)

- **Row anatomy:** two-line by default — Title-scale primary line + Label-scale meta line. Mono used for command names and timestamps; sans for descriptive labels.
- **Hover:** background tints to Surface Secondary, no transform, no scale.
- **Selected:** subtle Surface Secondary fill plus 1px-left visual is **prohibited** (anti-pattern). Use full-row tonal fill or a leading marker dot instead.

### Status Indicators

- **Dots:** 6–8px solid circle, paired with a label or context (chat title, list row). Amber = running, Sage = completed/idle, Coral = failed/needs attention, Muted = neutral. **Static; no pulse, no glow.** A pulsing dot reads as anxiety.

### Terminal pane (signature component)

`kanna-terminal` overrides xterm's default background to transparent, inheriting the page background. The PTY content sits in the same tonal field as the chat — the terminal is part of the document, not a separate window. Roboto Mono carries content; selection uses Surface Secondary; cursor blink is a single CSS animation, no canvas glow.

### Responsive and performance contracts

- **Mobile navigation:** the sidebar is a modal dialog below the desktop breakpoint. It traps focus, isolates the application outlet with `inert`, closes on Escape, and restores focus to the control that opened it.
- **Mobile settings:** settings use a sticky labeled section selector. The chat composer keeps preference controls behind a single 44 px “Chat settings” trigger and bottom sheet; closing the sheet restores focus to that trigger.
- **Interaction targets:** coarse-pointer controls are at least 44×44 px. Dense desktop icon controls are at least 32×32 px unless they qualify as inline text controls.
- **Overflow:** scrollable navigation and content expose a native scrollbar or replace overflow with a selector or sheet. Hidden-scrollbar utilities are prohibited.
- **Route boundaries:** non-chat routes and the diff renderer load behind lazy feature boundaries. The initial client entry must remain at or below **350,000 gzip bytes**, enforced by `bun run check:bundle` as part of `bun run check`.
- **Source contracts:** `transition-all`, sub-12 px utility type, operational all-caps, hidden-scrollbar utilities, and raw black/white interaction surfaces are build-blocking regressions.

## 6. Do's and Don'ts

### Do:

- **Do** tint every neutral toward hue 13° at chroma 0.003–0.013. White is `oklch(99.5% 0.003 13)`. Black is `oklch(20% 0.01 13)`. Pure `#fff` and `#000` are bugs.
- **Do** carry the One-Voice Rule: Kanna Coral on ≤10% of any screen, used for brand mark and destructive intent only.
- **Do** pair color with shape, label, or weight on every state indicator. Color alone never communicates.
- **Do** use Roboto Mono with `tabular-nums` for every duration, age, count, pid, or live ticker. Reflow under a ticker is a regression.
- **Do** keep dialogs flat: scale-and-fade entry, no backdrop blur, no nested modals; inline confirm flows for destructive actions.
- **Do** write keyboard shortcuts on every action. Every keyboard action also has a clear mouse target. No dead-ends in either direction.
- **Do** respect `prefers-reduced-motion`: disable all entry animations and translateY/translateX transitions.
- **Do** use the project `Tooltip` component. Native `title` attributes are prohibited as a hover-explanation surface.
- **Do** target body text contrast ≥ 7:1 (AAA) where the design allows; never below AA (4.5:1).

### Don't:

- **Don't** use `#000`, `#fff`, or any zero-chroma neutral. Tint everything toward hue 13°.
- **Don't** use purple-blue gradients, glassmorphism cards, or glow accents. Quoting PRODUCT.md: avoid "**generic AI SaaS gradient** — purple-blue hero gradients, glassmorphism cards, glow accents, ChatGPT-clone chrome."
- **Don't** ship marketing-cream backgrounds, oversized illustrations, or hero-feature-card grids. Quoting PRODUCT.md: avoid "**marketing-heavy SaaS-cream** — cream backgrounds, hero illustrations, 'feature card' grids, oversized CTA buttons."
- **Don't** put saturated green or cyan on a black background. Quoting PRODUCT.md: avoid "**neon terminal cyberpunk** — black background plus saturated green/cyan accents; hacker-aesthetic chrome."
- **Don't** stack panels at Datadog/Grafana density. Quoting PRODUCT.md: avoid "**cluttered devtool dashboards** — every pixel a panel, no breathing room, no hierarchy."
- **Don't** use `border-left` greater than 1px as a colored stripe to indicate state. Use a leading dot, full-row tint, or weight change instead.
- **Don't** clip text inside a gradient (`background-clip: text` with a gradient). Use a solid color; emphasis via weight or size.
- **Don't** open a modal on top of a modal. Inline confirm or step the existing dialog.
- **Don't** animate layout properties (`width`, `height`, `top`, `left`, `padding`). Animate `transform` and `opacity` only.
- **Don't** pulse status dots. A pulsing dot reads as anxiety; the warm coral is alarming enough on its own when it appears.
- **Don't** use `outline: none` on focusable elements without a clear replacement focus indicator.
- **Don't** rely on color alone for status; pair with icon, label, or weight.
