# Plan: user-adjustable typography scale

**Spec:** `docs/tribe/planning/typography-scale-preference-spec.md`
**Card:** `typography-scale-preference` · **Branch:** `feat/typography-scale-preference`

---

## Global Constraints

- **Implementer: dispatch each implementation/fix task to the `hunter` subagent — never a generic
  implementer.**
- **Purity: core logic stays deterministic and side-effect-free; every outside-world dependency
  (database, network, filesystem, clock, random, global state) enters through an abstraction
  injected from the edge — never constructed inside core logic (see `~/.claude/rules/pure-core.md`).**
- **TDD is mandatory:** write the failing test, run it, watch it fail for the right reason, then
  make it pass. Paste the RED output into your report.
- **Commit rules:** tick your task's checkboxes in the SAME commit as the code. Every commit
  carries, in ONE final paragraph:
  `Tribe-Card: typography-scale-preference` and `Tribe-Task: N/16`.
  **Never add a `Co-Authored-By` line for any agent — explicit owner prohibition.**
- **Gates:** `bun run typecheck`, `bun run lint`, `bun run lint:usestate`, and
  `bun test --conditions production` (the `--conditions production` flag is load-bearing: Lexical's
  dev build has a circular-ESM TDZ crash without it).
- **`as` casts are banned** by the lint config. Use angle-bracket casts:
  `<Partial<X> | undefined>value`.
- **`useState` is banned in `src/client/**`** (`rules/no-react-usestate.yml`). `useTheme.tsx` is
  allowlisted; **your new files are not, and you must not extend the allowlist.** Drive off stores.
- **Raw `document`/`window`/`localStorage` are banned in `src/client/**`**
  (`rules/no-clientside-effects.yml`). Go through a port.
- **Never run `c3x repair`** — it rewrites canonical `.c3/` markdown and strips backticks. If you
  run any `c3x` write, run `git status .c3/` immediately and `git checkout --` anything unintended.
- **Do not touch `.github/workflows/test.yml`.** The Playwright harness stays off the CI path.
- **Scope fence:** do **not** fix `"Roboto Mono"` being referenced but never loaded
  (`src/index.css:267`). It is a known pre-existing bug, explicitly out of scope.


> **Amendment (Warchief, after Task 4's `NEEDS_CONTEXT`):** filesystem-reading tests live in
> `src/server/design/`, never `src/client/design/`. `eslint.config.js:228-236` bans `node:fs` (and the
> `Bun` global) across ALL of `src/client/**` and `src/shared/**` with **no** test exemption, while the
> `src/server/**` block at `:304-312` explicitly exempts `*.test.ts`. The in-repo precedent is
> `src/server/design/tone-pairings.test.ts`, which already parses `src/index.css` — a client asset read
> from a server-side test. We relocate rather than widen the lint rule: evading an architecture rule to
> place a test is not a trade this card gets to make.

> **Amendment (Warchief, after wave-1 audit — e2e harness boots the PRODUCTION build, not `bun run dev`):**
> The card/spec named `bun run dev` (Vite 5174 + backend 5175) as the Playwright boot mechanism. That
> mechanism is **unusable in this environment**: Vite's dev-server WebSocket proxy leg (`vite.config.ts`
> `"/ws": { ws: true }`) never completes the upgrade under Bun — verified by the Warchief with raw `curl`
> (through Vite `/ws` → `http_code=000`, hangs; direct to the Bun backend `/ws` → `101 Switching Protocols`).
> So the app never leaves the "Connecting to workspace" splash under `bun run dev`, and no real-browser
> font-size can be observed. **Resolution (How-level, Warchief's call):** the harness (`e2e/boot.ts`, Task 5;
> and the P10 assertions, Task 16d) boots the **production single-process server** — `bun run build` then
> `bun run start --port <testPort> --no-open --strict-port` against a seeded temp `HOME` — which serves the
> SPA and `/ws` from one Bun process with **no proxy hop** (same origin). Warchief-proved: real Chrome vs.
> the production server leaves the splash, renders the real app UI, `documentElement` font-size `16px`, zero
> console errors. This **preserves the card's measurable goal** (real browser, real computed font-size, real
> app) and is arguably stronger evidence — it exercises the artifact users actually run. Task 16d's P10
> assertions build against this production-serve harness, not `bun run dev`.

### The names every task shares (fix these exactly, do not invent variants)

| Name | Value |
|---|---|
| CSS scale variable | `--kanna-font-scale` |
| Steps → multipliers | `sm` 0.875 · `md` 1.0 · `lg` 1.125 · `xl` 1.25 · `xxl` 1.5 |
| Pure core module | `src/shared/design/typography.ts` |
| Settings normalizer module | `src/shared/settings/typography.ts` |
| Persist store key | `kanna-preferences` (zustand `persist`, bumping `version: 1` → `2`) |
| Device override field | `typographyOverride?: FontScaleStep` |
| Pre-paint cache field | `typographyServerDefaultCache?: FontScaleStep` |

---

## Wave 1 — foundations (4 sub-plans, dispatched CONCURRENTLY, disjoint files)

### Task 1 — pure core (P1) · owns `src/shared/design/**`

Create `src/shared/design/typography.ts` and `src/shared/design/typography.test.ts`.

**Purity is a review gate, not a suggestion.** Every function here takes its inputs as arguments.
No DOM, no storage, no clock, no store reads, no imports from `src/client/**`.

```ts
export type FontScaleStep = "sm" | "md" | "lg" | "xl" | "xxl"
export const FONT_SCALE_STEPS: readonly FontScaleStep[] = ["sm", "md", "lg", "xl", "xxl"]
export const FONT_SCALE_MULTIPLIERS: Record<FontScaleStep, number> = {
  sm: 0.875, md: 1, lg: 1.125, xl: 1.25, xxl: 1.5,
}
export const DEFAULT_FONT_SCALE_STEP: FontScaleStep = "md"

export interface TypographyPreference { scale: FontScaleStep }

export function isFontScaleStep(value: unknown): value is FontScaleStep

/** Total function: any unknown/garbage/out-of-range input resolves to 1 (md). */
export function resolveFontScale(step: unknown): number

/** PURE precedence: deviceOverride ?? serverDefault ?? "md". Reads no store. */
export function resolveEffectiveScaleStep(deviceOverride: unknown, serverDefault: unknown): FontScaleStep

/**
 * Emits a MAP of CSS custom properties — never a single hardcoded write.
 * Adding a font family later is ONE new key here plus one stylesheet rule,
 * with zero change to the applier, the DomPort, or the persistence plumbing.
 */
export function resolveTypographyVars(pref: TypographyPreference | undefined): Record<string, string>
```

`resolveTypographyVars(undefined)` returns `{ "--kanna-font-scale": "1" }`.

Tests must cover: all five steps map to their documented multiplier; `undefined`, `null`, `""`,
`"MD"`, `"huge"`, `0`, `NaN`, `{}`, `[]` all fall back to `md`/`1`; the precedence rule across the
full matrix (both set → device wins; only device; only server; neither; garbage device + valid
server → server wins, because garbage is not an override).

**Expected result:** `bun test --conditions production src/shared/design/typography.test.ts` passes;
`resolveTypographyVars({ scale: "lg" })` deep-equals `{ "--kanna-font-scale": "1.125" }`.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): pure font-scale core" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 1/16'
```

- [x] Task 1 complete

### Task 2 — settings normalizer module · owns `src/shared/settings/typography.ts`

Create `src/shared/settings/typography.ts` + `typography.test.ts`, modeled **exactly** on the
existing `src/shared/settings/uploads.ts` / `uploads.test.ts` pair (interface + `*_DEFAULTS` +
`normalize*(value, warnings)`), and re-export it from `src/shared/settings/index.ts`.

```ts
import { DEFAULT_FONT_SCALE_STEP, isFontScaleStep, type FontScaleStep } from "../design/typography"

export interface TypographySettings { scale: FontScaleStep }
export const TYPOGRAPHY_DEFAULTS: TypographySettings = { scale: DEFAULT_FONT_SCALE_STEP }

/** Untrusted on-disk input -> valid settings; pushes a human message per rejected field. */
export function normalizeTypographySettings(value: unknown, warnings: string[]): TypographySettings
```

Follow `uploads.test.ts`'s skeleton: one test per input class (undefined → defaults; non-object →
defaults + warning; valid; wrong type → default + warning; unknown step string → default + warning),
each threading its own `const warnings: string[] = []` and asserting on it.

**Expected result:** `bun test --conditions production src/shared/settings/typography.test.ts`
passes; `normalizeTypographySettings({ scale: "nope" }, w)` returns `{ scale: "md" }` and pushes
exactly one warning into `w`.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): settings normalizer for typography group" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 2/16'
```

- [x] Task 2 complete

### Task 3 — stylesheet foundation (P3, P5-CSS) · owns `src/index.css`, `src/server/design/typography-css.test.ts`

**Read `src/server/design/tone-pairings.test.ts` first** — it already parses `src/index.css` and
computes over it. Your test is that idiom applied to typography. It is a **server-side** test
(no happy-dom needed) and it is the load-bearing P3 proof: without it, P1 and P2 pass green and
nothing renders larger.

Edits to `src/index.css`:

1. In the `@theme` block (currently `src/index.css:120-156`) add all ten steps. **Define NO
   `--text-N--line-height` companion** — that omission is what makes these font-size-only, exactly
   like the `text-[Npx]` utilities they replace:

```css
  /* Typography steps, named for their px size at scale 1.0 (root 16px).
     Deliberately NO --text-N--line-height pair: a stock step like `text-base`
     also emits line-height, which would silently change rendering. */
  --text-9: 0.5625rem;
  --text-10: 0.625rem;
  --text-11: 0.6875rem;
  --text-12: 0.75rem;
  --text-13: 0.8125rem;
  --text-15: 0.9375rem;
  --text-16: 1rem;
  --text-18: 1.125rem;
  --text-20: 1.25rem;
  --text-22: 1.375rem;
```

2. In `@layer base`, add the root rule (the `, 1` fallback keeps no-JS/pre-hydration identical):

```css
  html {
    font-size: calc(16px * var(--kanna-font-scale, 1));
  }
```

3. `input, textarea, select` (`src/index.css:186-191`): `font-size: 16px` → `font-size: max(16px, 1rem)`.
   This scales UP but never below 16px, preserving the **Mobile-Input-16 Rule** (`DESIGN.md:207`).
4. `--shell-top-band` (`:76` and the `md:` override at `:82`): `64px` → `4rem`, `55px` → `3.4375rem`.
5. `--diffs-font-size` (`:318`): `11px` → `0.6875rem`.
6. Route the three font stacks through variables declared on `:root` —
   `--kanna-font-body`, `--kanna-font-logo`, `--kanna-font-mono` — and make `body` (`:173`),
   `.font-logo` (`:182`) and `code, pre` (`:267`) consume them. Keep the stack VALUES byte-identical;
   this is a redirection, not a restyle. **Do not fix the missing Roboto Mono font-face.**

The test (`src/server/design/typography-css.test.ts`) reads `src/index.css` from disk and asserts:

- an `html` rule declares `font-size` containing `var(--kanna-font-scale`;
- the `input, textarea, select` rule's `font-size` is `max(16px, 1rem)` — assert the literal
  `16px` floor is present, since losing it silently reintroduces iOS zoom-on-focus;
- all ten `--text-N` tokens exist and each equals `N / 16` rem (compute it, do not hardcode a table);
- **no `--text-N--line-height` property is declared anywhere in the file**;
- `--diffs-font-size` and `--shell-top-band` are rem-valued (no `px` literal);
- `body`, `.font-logo`, `code, pre` each reference a `var(--kanna-font-*)`.

**Expected result:** `bun test --conditions production src/server/design/typography-css.test.ts`
passes. Every assertion must FAIL first against the unmodified `src/index.css` — paste that RED
output.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): wire --kanna-font-scale into the stylesheet" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 3/16'
```

- [x] Task 3 complete

### Task 4 — the px ratchet (P4) · owns `src/server/design/px-text-ratchet.test.ts`

A ratchet test that counts arbitrary-px text utilities in `src/client/**` and asserts
`count <= CAP`, with `CAP = 169` (the true current count — verified: 169 across 46 files).

```ts
// CAP only ever goes DOWN. Never raise it. The typography-scale card drives it to 0.
const CAP = 169
```

Walk `src/client/**` for `.ts`/`.tsx`, match `/text-\[\d+px\]/g`, sum. Assert `<= CAP`, and also
assert the count is `> 0` **only while CAP > 0** — so the test cannot pass vacuously if the walker
silently globs nothing (a walker bug must fail, not pass).

**Expected result:** `bun test --conditions production src/server/design/px-text-ratchet.test.ts`
passes at exactly 169; temporarily setting `CAP = 168` makes it fail. Paste both outputs.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "test(typography): ratchet arbitrary-px text utilities at 169" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 4/16'
```

- [x] Task 4 complete

### Task 5 — Playwright harness bootstrap (P10 infrastructure) · owns `e2e/**`, `package.json`

De-risked already: Playwright drives the **installed Google Chrome** via `channel: "chrome"` — no
browser download. Verified this session: real computed font-size 16px → 24px at scale 1.5, and a
2560×1440 screenshot captured.

1. `bun add -D @playwright/test`.
2. `e2e/playwright.config.ts`: `channel: "chrome"`, viewport `2560×1440`, no CI reporter wiring.
3. `e2e/boot.ts`: start `bun run dev` as a child process with `KANNA_HOME` pointed at a **seeded
   temp dir** (`mkdtemp`), wait for the Vite URL to answer, return a stop handle. Reuse the polling
   shape of `waitForLocalUrl` at `scripts/dev.ts:110-127`. Guarantee the child is killed and the
   temp dir removed on both success and failure.
4. `e2e/typography.spec.ts` — bootstrap smoke only for now: boot, load `/`, assert the computed
   `font-size` of `document.documentElement` is `16px` at default scale.
5. `package.json` script: `"test:e2e": "playwright test -c e2e/playwright.config.ts"`.
   **Do not touch `.github/workflows/test.yml`.**

**Expected result:** `bun run test:e2e` boots the real app and the smoke spec passes, reporting
`16px`. Paste the run output. If the app cannot boot headless (auth wall, missing binary), STOP and
report `BLOCKED` with the exact error — do not stub the assertion out.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "test(typography): playwright harness bootstrap" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 5/16'
```

- [x] Task 5 complete

---

## Wave 2 — persistence plumbing (2 sub-plans, CONCURRENT, disjoint files)

### Task 6 — server + shared settings plumbing · owns `src/shared/app-settings-types.ts`, `src/server/app-settings.ts`, `src/server/ws-router-defaults.ts`, their tests

`typography` is a **GROUP, never a bare scalar**: `typography: TypographySettings`. This is the
card's hard extensibility requirement — `bodyFamily` later must be an additive field.

Add the field at every site below. **The compiler catches only half of them**; the rest are silent
data loss, which is why each is listed explicitly:

| # | Site | Note |
|---|---|---|
| 1 | `app-settings-types.ts:285` `AppSettingsSnapshot` | next to `theme` |
| 2 | `app-settings-types.ts:335` `AppSettingsPatch` | `typography?: Partial<TypographySettings>` |
| 3 | `app-settings.ts:101` `AppSettingsFile` | loose on-disk type: `typography?: { scale?: string }` |
| 4 | `app-settings.ts:965` `const state` | `typography: normalizeTypographySettings(source?.typography, warnings)` |
| 5 | `app-settings.ts:859` `toFilePayload` | **return type is INFERRED — omission = never persisted, no type error** |
| 6 | `app-settings.ts:888` `toSnapshot` | compiler-enforced |
| 7 | `app-settings.ts:1020` `toComparablePayload` | **omission = `shouldWrite` always true = file rewritten on EVERY load** |
| 8 | `app-settings.ts:1516` `applyPatch` | add `typography: { ...state.typography, ...patch.typography }` |
| 9 | `ws-router-defaults.ts:171` `buildInitialAppSettingsSnapshot` | `typography: TYPOGRAPHY_DEFAULTS` |
| 10 | `ws-router-defaults.ts:40` server `mergeAppSettingsPatch` | the server twin — easy to miss |

Also update the four test snapshot literals: `src/server/app-settings.test.ts:44`,
`src/server/ws-router-settings.test.ts:31`, `src/server/ws-router.test.ts:94`,
`src/server/server.test.ts:21`. `ws-router.test.ts` additionally has two hand-rolled `writePatch`
fakes (~`:550`, ~`:3313`) that enumerate fields by hand — add `typography` or they silently drop it.

Do **not** change `protocol.ts` or `ws-router-settings.ts` (both are generic over
`AppSettingsPatch`), and do **not** add typography to `buildAgentAppSettingsView` (`server.ts:122`)
— that projection deliberately excludes `theme` too.

New tests (copy `app-settings.test.ts:159-200`, the expanded-patch round-trip):

```ts
// 1. round-trip: writePatch({ typography: { scale: "lg" } }) -> snapshot.typography.scale === "lg"
//    AND the re-read JSON file on disk has typography.scale === "lg"   (covers toFilePayload)
// 2. sibling preservation via the server mergeAppSettingsPatch          (covers site 10)
// 3. no-op stability: initialize twice, assert the settings file content is
//    BYTE-IDENTICAL the second time                                     (covers toComparablePayload)
```

Test 3 is the one that catches site 7, which no existing test covers.

**Expected result:** `bun test --conditions production src/server/app-settings.test.ts src/server/ws-router-defaults.test.ts` passes, and `bun run typecheck` is clean.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): persist typography group server-side" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 6/16'
```

- [x] Task 6 complete

### Task 7 — DomPort method + device store · owns `src/client/ports/domPort.ts`, `src/client/adapters/dom.adapter.ts`, the three fakes, `src/client/stores/preferences.ts`

**7a — the port (P2).** Add to `DomPort`, adjacent to `setDocumentElementColorScheme`
(`domPort.ts:157`):

```ts
/** Sets a CSS property on `document.documentElement.style` (e.g. a CSS custom property). */
setDocumentElementStyleProperty(property: string, value: string): void
```

Implement in `dom.adapter.ts` mirroring `setBodyStyle` (`dom.adapter.ts:63-65`):

```ts
setDocumentElementStyleProperty(property: string, value: string): void {
  document.documentElement.style.setProperty(property, value)
},
```

This **will break three typed fakes at compile time. That is the design**, not an accident — they
are declared `const x: DomPort` rather than cast, precisely so a new port member is a compile error
(see the rationale comment at `src/client/lib/testing/fakePorts.ts:5-19`). Fix all three:

- `src/client/hooks/useTheme.test.ts` (~`:42`) — inert no-op.
- `src/client/lib/testing/fakePorts.ts` (~`:75`) — inert, arrow-property style.
- `src/client/adapters/testing/makeFakePorts.ts` (~`:486`) — **recording**: add a public
  `documentElementStyles: Map<string, string>` field (mirror the `bodyStyles` precedent at
  `makeFakePorts.ts:248` + `:317` + `:392`) so the write is assertable in Task 8.

**7b — the device override store.** `src/client/stores/preferences.ts`: add
`typographyOverride?: FontScaleStep` and `typographyServerDefaultCache?: FontScaleStep` with named
intent actions (`setTypographyOverride`, `clearTypographyOverride`, `cacheTypographyServerDefault`
— **never** updater-shaped passthrough setters; `rule-zustand-store`). Bump `version: 1` → `2`,
widen `PersistedPreferencesState`, and extend the `Pick<...>` return of `migratePreferencesState`.

**Persist ONLY via the zustand `persist` middleware — write no custom `localStorage` call.**
`rule-zustand-store` forbids it verbatim, and `no-clientside-effects.yml` bans the global outright.
The middleware's own write is what the pre-paint script (Task 9) later reads.

Extend `src/client/stores/preferences.test.ts`: defaults are `undefined`; each action; and a
migration test proving a `version: 1` blob (`{ autoResumeOnRateLimit: true }`) survives to v2 with
`autoResumeOnRateLimit` intact and typography fields `undefined`. That last test is the
`c3-116` Change Safety requirement ("Lost preferences on schema bump") discharged.

**Expected result:** `bun run typecheck` clean (all three fakes updated) and
`bun test --conditions production src/client/stores/preferences.test.ts src/client/hooks/useTheme.test.ts` passes.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): document-element style port + device override store" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 7/16'
```

- [x] Task 7 complete

---

## Wave 3 — apply it to the document (1 sub-plan)

### Task 8 — the applier · owns `src/client/hooks/useTypography.tsx` + test

A **separate module from `useTheme`** — deliberately. ~10 component tests `mock.module` the theme
hook wholesale (e.g. `TextMessage.test.tsx:4-5`); widening `ThemeContextValue` would break every one
of them.

**No `useState`.** Your file is not in the `no-react-usestate` allowlist and you must not add it.
Derive everything from the two stores:

```tsx
export function TypographyProvider({ children, dom = domAdapter }: { children: ReactNode; dom?: DomPort }) {
  const serverDefault = useAppSettingsStore((s) => s.settings?.typography?.scale)
  const deviceOverride = usePreferencesStore((s) => s.typographyOverride)
  const step = resolveEffectiveScaleStep(deviceOverride, serverDefault)   // PURE
  useEffect(() => {
    for (const [property, value] of Object.entries(resolveTypographyVars({ scale: step }))) {
      dom.setDocumentElementStyleProperty(property, value)
    }
  }, [step, dom])
  // ...also cache the server default for pre-paint (Task 9), via the store action only
}
```

**Iterating the returned map is mandatory and is a review gate.** A hunter who writes
`dom.setDocumentElementStyleProperty("--kanna-font-scale", …)` — one hardcoded key instead of a loop
over the map — **has failed this card even with a green suite**, because adding a font family later
would then require changing the applier. This will be rejected in audit.

Mount it in `src/main.tsx` inside `ThemeProvider`.

Tests use `makeFakeDomPort()` and assert against its `documentElementStyles` recorder: default →
`--kanna-font-scale: "1"`; server `lg` alone → `1.125`; device `xxl` over server `lg` → `1.5`;
clearing the override falls back to the server value. Follow the house idiom
(`renderToStaticMarkup` / `renderForLoopCheck`) and **unmount any container you append to
`document.body`** — `scripts/test-preload.ts` fails any test leaking a React-owned node.

**Expected result:** `bun test --conditions production src/client/hooks/useTypography.test.tsx`
passes, and `bun run lint:usestate` stays clean (proving no `useState` crept in).

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): apply the typography var map to the document" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 8/16'
```

- [x] Task 8 complete

### Task 9 — pre-paint, no flash (P6) · owns `index.html`, `src/server/design/prePaint.test.ts`

A font-size FOUC reflows the **entire** layout — far worse than the theme flash that exists today.
Extend the existing blocking IIFE at `index.html:14-26` (a classic, non-module `<script>`, so it
runs synchronously before body parse) to also apply the typography scale.

It must **read** `localStorage["kanna-preferences"]` — the zustand persist envelope is
`{ state: {...}, version: n }`, so the path is `parsed?.state?.typographyOverride ??
parsed?.state?.typographyServerDefaultCache` — inside a `try/catch`, and set
`--kanna-font-scale` on `document.documentElement`. A malformed or absent blob must leave the
document untouched (the CSS `var(..., 1)` fallback then renders exactly as today).

**The test does not test a copy — it tests the shipped artifact.** An inline blocking script cannot
import a module, so duplicating the logic and testing the duplicate would prove nothing. Instead:
read `index.html` from disk, extract the inline `<script>` body, execute it via `new Function`
against a **fake** `localStorage` + `documentElement` stub, and assert the resulting property map
equals `resolveTypographyVars(resolveEffectiveScaleStep(override, cached))` computed by the pure
module for the same seeded input. That pins the shipped snippet to the pure oracle.

Cover: no blob; malformed JSON; `version 1` blob with no typography keys; override only; cache only;
both (override wins); garbage step value (falls back to `1`).

**Expected result:** `bun test --conditions production src/server/design/prePaint.test.ts` passes,
including a case proving a seeded `xxl` override yields `--kanna-font-scale: "1.5"` **before** any
React code runs.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): apply scale pre-paint to avoid layout flash" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 9/16'
```

- [x] Task 9 complete

---

## Wave 4 — surfaces (2 sub-plans, CONCURRENT, disjoint files)

### Task 10 — Settings → General row + real-router test (P7) · owns `src/client/app/SettingsPage.tsx`, `src/client/stores/settingsPageStore.ts`, the route test

Insert a `SettingsRow` immediately after the Theme row (`SettingsPage.tsx:1934-1944`), at ~`:1945`.
Match the Theme row's idiom exactly: `SettingsRow` + `SegmentedControl` if five options fit legibly,
else `Select` (`SettingsPage.tsx:1946` is the in-repo `Select` example). **Do not pass
`bordered={false}`** — every row after the first inherits `bordered = true`, and passing it would
delete the separator line.

The row must:
- show the **effective** value (`resolveEffectiveScaleStep(override, serverDefault)`);
- indicate when **this device is overridden**;
- offer an explicit **"Use account default"** reset that clears the override.

Changing the control writes the **server default** via
`handleWriteAppSettings({ typography: { scale: next } })`, following `handleThemeChange`
(`SettingsPage.tsx:1510-1515`) including its `.catch` → `setAppSettingsError`. Any draft UI state
belongs in `src/client/stores/settingsPageStore.ts` — **no `useState`.**

**P7 — mount the REAL router.** `scripts/verify-session-tabs.sh` exists because a
blank-white-page regression once shipped with 4910 tests green: *every test mounted the Provider by
hand and none rendered the real router*. Do not repeat that.

`SettingsPage` **cannot** be mounted standalone: it calls `useOutletContext` (`SettingsPage.tsx:30`)
and `useTheme()` (which throws outside a provider). The test needs
`MemoryRouter initialEntries={["/settings/general"]}` → `Routes` → a layout `Route` rendering
`<Outlet context={fakeKannaState}/>` → `ThemeProvider` → the settings route. `BoardsRoutePage.test.tsx:85-92`
and `StackBoardsRoutePage.test.tsx:68-75` are the in-repo precedent for the outlet-context wrapper.
Assert the typography control is actually present in the rendered output.

**Unmount before the test ends.** A Radix `Select` portals into `document.body`, and
`scripts/test-preload.ts` fails any test that leaks a React-owned node. Use `renderForLoopCheck`
(whose registry guarantees teardown) or never append the container.

**Expected result:** the new test renders `/settings/general` through a real `MemoryRouter` and
asserts the typography control is present; `bun test --conditions production src/client/app/` passes
with no leaked-node failure.

- [x] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): Settings > General typography row" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 10/16'
```

- [x] Task 10 complete

### Task 11 — the three independent scales (P5) · owns `TerminalPane.tsx` + test, `lexical/config.ts`, `markdown/renderMessage.tsx`, `markdown/lexicalToReact.tsx`, + drift test

**11a — xterm is canvas and wholly immune to CSS.** `getTerminalOptions`
(`TerminalPane.tsx:153-167`, `fontSize: 13` hardcoded at `:163`) must take the font size as a
parameter. It is already a pure function with tests at `TerminalPane.test.ts:4-14` — extend those.
A scale change must **refit** (the cell-metric path at `TerminalPane.tsx:110-133`) **and send a PTY
resize** — otherwise the server's terminal dimensions silently desync from what the user sees.
Derive the terminal font size from the same pure core: `13 * resolveFontScale(step)`, rounded.

**11b — the Lexical heading sizes are triplicated** across `lexical/config.ts:10-15`,
`markdown/renderMessage.tsx:117`, and `markdown/lexicalToReact.tsx:103`. Convert all three to the
`--text-N` tokens from Task 3, and **add a test that pins the three maps equal to each other** so
they can never drift again. The test must fail if any one copy changes alone.

**Expected result:** `bun test --conditions production src/client/components/` passes, including a
new `getTerminalOptions` case proving the font size changes with the scale, and a drift test that
fails when one Lexical copy is edited in isolation. Paste the deliberately-broken-copy failure.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): scale terminal, lexical and diff typography" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 11/16'
```

- [ ] Task 11 complete

---

## Wave 5 — the mechanical conversion (4 sub-plans, CONCURRENT, file-disjoint)

169 occurrences across 46 files. The mapping is a **uniform, mechanical substitution**:

```
text-[9px]→text-9   text-[10px]→text-10  text-[11px]→text-11  text-[12px]→text-12
text-[13px]→text-13 text-[15px]→text-15  text-[16px]→text-16  text-[18px]→text-18
text-[20px]→text-20 text-[22px]→text-22
```

**Never map to a stock named step** (`text-xs`/`text-sm`/`text-base`/`text-lg`/`text-xl`). Verified
by compiling Tailwind v4.3.3: `.text-base` emits `font-size` **and** `line-height`, while a custom
`--text-N` token with no paired line-height var emits font-size only. Mapping to stock steps would
silently change line-height on the 32 sites whose values match a stock step, breaking the card's
"`md` is byte-identical" requirement.

Change **nothing else** — no refactors, no reformatting, no "while I'm here" fixes. Do **not** lower
the ratchet CAP (Task 16 does that once, at the end).

Each task below owns a disjoint set of paths. After converting, verify your own area is clean and
run the suite for it.

### Task 12 — convert `src/client/components/boards/**`

```bash
grep -roE 'text-\[[0-9]+px\]' src/client/components/boards | wc -l   # must print 0
bun test --conditions production src/client/components/boards
```

**Expected result:** prints `0`; typecheck, lint and the area's tests all pass.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "refactor(typography): convert boards px text utilities to rem tokens" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 12/16'
```

- [ ] Task 12 complete

### Task 13 — convert `src/client/components/chat-ui/**`

```bash
grep -roE 'text-\[[0-9]+px\]' src/client/components/chat-ui | wc -l  # must print 0
bun test --conditions production src/client/components/chat-ui
```

**Expected result:** prints `0`; typecheck, lint and the area's tests all pass.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "refactor(typography): convert chat-ui px text utilities to rem tokens" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 13/16'
```

- [ ] Task 13 complete

### Task 14 — convert `src/client/components/**` EXCEPT `boards/` and `chat-ui/`

Those two directories belong to Tasks 12 and 13 — a concurrent hunter owns them. Do not touch them.

```bash
grep -roE 'text-\[[0-9]+px\]' src/client/components \
  --exclude-dir=boards --exclude-dir=chat-ui | wc -l                 # must print 0
bun test --conditions production src/client/components
```

**Expected result:** prints `0`; typecheck, lint and the area's tests all pass.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "refactor(typography): convert remaining component px text utilities" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 14/16'
```

- [ ] Task 14 complete

### Task 15 — convert `src/client/app/**`, `src/client/hooks/**`, and any remaining `src/client/**`

```bash
grep -roE 'text-\[[0-9]+px\]' src/client \
  --exclude-dir=components | wc -l                                   # must print 0
bun test --conditions production src/client/app
```

**Expected result:** prints `0`; typecheck, lint and the area's tests all pass.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "refactor(typography): convert app and hooks px text utilities" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 15/16'
```

- [ ] Task 15 complete

---

## Wave 6 — lock it in

### Task 16 — ratchet to 0, regression lock, and the oracle · owns `rules/**`, `rule-tests/**`, `scripts/verify-typography-scale.sh`, ratchet test, `e2e/typography.spec.ts`, `CLAUDE.md`

**16a — CAP to 0.** Set `CAP = 0` in `src/server/design/px-text-ratchet.test.ts` and drop the
`> 0` vacuity guard (it is conditioned on `CAP > 0`).

**16b — the ast-grep regression lock.** Now — and only now — add a rule banning **new** arbitrary-px
text utilities in `src/client/**`. It lands last on purpose: landing it earlier would flag all 169
existing sites and hold CI red for five waves. Ship the full repo-convention set — **2 rule files +
2 test files + 2 snapshot files**:

- `rules/no-arbitrary-px-text.yml` (`language: tsx`) and `rules/no-arbitrary-px-text-ts.yml`
  (`language: typescript`, byte-identical but for `id`/`language`), `severity: error`,
  `files: [src/client/**]`, ignoring `**/*.test.ts(x)`.
- `rule-tests/no-arbitrary-px-text-test.yml` + `-ts-test.yml` (flat `valid:`/`invalid:` snippet
  lists).
- `rule-tests/__snapshots__/no-arbitrary-px-text-snapshot.yml` + `-ts-snapshot.yml` —
  **generated**, never hand-authored (`ast-grep test -U`).

**16c — the oracle.** `scripts/verify-typography-scale.sh`, copied from
`scripts/verify-session-tabs.sh`: `ast-grep scan` → `lint` → `typecheck` → full suite with
`--conditions production --reporter=junit --reporter-outfile`, then `require_test` on **exact named
tests**. Its own rationale is the standard: *"Checking 'a test file exists and passes' is too weak —
a worker can satisfy it with a test that asserts nothing interesting."*

That weakness is **live in this repo**: `ChatPage.tabs.test.tsx:69` satisfies a `require_test` for
"renders through the real router" without importing `react-dom` or `react-router-dom` at all. So
pair each required test name with something the name alone cannot fake — e.g. grep the P7 test file
for `MemoryRouter` **and** a real render call. Include the **meta-test**: a deliberately-broken
fixture must make the gate **fail** (mirror `tone-pairings.test.ts`).

**16d — P10 feature assertions.** Extend `e2e/typography.spec.ts` to drive Settings → General to
each of the five steps and assert the **real computed `font-size`** on sampled elements changes
accordingly, assert the terminal pane's cell metrics change at a non-default step (the canvas case
no DOM test can reach), and confirm text does not clip the `--shell-top-band` at `xxl`. Capture the
P9 screenshots programmatically: 2560×1440, chat + settings + sidebar, at `md` and `xxl`, in both
light and dark, into `e2e/screenshots/`.

**16e — `CLAUDE.md:2179` is stale** — it documents `wiki/scripts/capture-all.sh` capturing ~32 PNGs
via Playwright. That script does not exist and there is no Playwright in `wiki/bun.lock`. Correct
that line to describe the harness this card actually ships.

**Expected result:** `bash scripts/verify-typography-scale.sh` exits 0; `bun run lint:usestate`
passes with the new rules active; `grep -roE 'text-\[[0-9]+px\]' src/client | wc -l` prints `0`;
`bun run test:e2e` passes and writes the screenshot set. Paste the meta-test's deliberate failure.

- [ ] **Step 1: Commit** — exactly one commit ends this task:

```bash
git add -A
git commit -m "feat(typography): lock the ratchet at zero and add the oracle" \
  -m $'Tribe-Card: typography-scale-preference\nTribe-Task: 16/16'
```

- [ ] Task 16 complete

---

## Verification contract → task map

| P | Discharged by |
|---|---|
| P1 pure scale function | Task 1 |
| P2 reaches `<html>` via DomPort | Tasks 7, 8 |
| P3 var wired to root font-size in CSS | Task 3 |
| P4 px ratchet 169 → 0 + ast-grep lock | Tasks 4, 12–15, 16a, 16b |
| P5 escape hatches correct | Tasks 3 (CSS), 11 (xterm, Lexical) |
| P6 persists, no flash | Tasks 6, 7, 9 |
| P7 real router renders | Task 10 |
| P8 nothing else broke | every task's gates + final CI |
| P9 screenshot evidence | Task 16d |
| P10 Playwright harness | Tasks 5, 16d |

**The C3 doc update (`c3-116`) and the PR are the Warchief's, not a Hunter's.**
