# Spec: user-adjustable typography scale (Settings → General)

**Card:** `typography-scale-preference`
**Author:** Warchief
**Worktree:** `/Users/hip/repo/kanna-wt-typography` — branch `feat/typography-scale-preference`, base `36e25ba`
**Owning C3 fact:** `c3-116` (`settings-page`), container `c3-1`, governed by `ref-local-first-data`,
`ref-zustand-store`, `rule-zustand-store`.

This spec answers **How**. The What/Why is settled by the idea card and is not reopened here.

---

## 1. The problem, grounded in code

Kanna's root font size is the browser default and nothing overrides it: `src/index.css:163-168`
declares `html, body, #root { height: 100%; overflow: hidden }` and **no `font-size`**. There is
no typography setting of any kind.

The user cannot work around it either. `index.html:5` ships:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no" />
```

`user-scalable=no, maximum-scale=1` disables browser pinch-zoom, so an in-app control is the only
path a user has to enlarge Kanna's text. That is the accessibility weight of this card.

Two independent obstacles stand between "scale the root" and "the app gets bigger":

1. **169 arbitrary-px text utilities** (`text-[13px]` and friends) across 46 files in
   `src/client/**` are absolute and do not respond to root scaling. Verified this session:

   | value | count | | value | count |
   |---|---|---|---|---|
   | `text-[13px]` | 57 | | `text-[16px]` | 14 |
   | `text-[11px]` | 39 | | `text-[15px]` | 10 |
   | `text-[10px]` | 35 | | `text-[20px]` | 4 |
   | `text-[18px]` | 4 | | `text-[12px]` | 4 |
   | `text-[22px]` | 1 | | `text-[9px]` | 1 |

   (643 *named* utilities — `text-xs`, `text-sm`, … — are rem-based and scale for free.)

2. **Three independent scales** that CSS root scaling cannot reach: the xterm terminal (canvas),
   `@pierre/diffs` (`--diffs-font-size: 11px`, `src/index.css:318`), and the Lexical heading maps
   (triplicated).

## 2. The change

### 2.1 The pure core (P1)

New module `src/shared/design/typography.ts`. Everything here is **pure**: no DOM, no storage, no
clock, no store reads. Per `~/.claude/rules/pure-core.md`, all inputs arrive as arguments.

```ts
export type FontScaleStep = "sm" | "md" | "lg" | "xl" | "xxl"

export interface TypographyPreference { scale: FontScaleStep }

export const FONT_SCALE_MULTIPLIERS: Record<FontScaleStep, number>
  // sm 0.875 | md 1.0 | lg 1.125 | xl 1.25 | xxl 1.5

export function isFontScaleStep(value: unknown): value is FontScaleStep
export function resolveFontScale(step: unknown): number          // unknown/garbage -> 1.0
export function resolveEffectiveScaleStep(
  deviceOverride: unknown, serverDefault: unknown,
): FontScaleStep                                                  // deviceOverride ?? serverDefault ?? "md"
export function resolveTypographyVars(
  pref: TypographyPreference | undefined,
): Record<string, string>                                         // { "--kanna-font-scale": "1.125" }
```

Two properties are load-bearing and both are named requirements of the card:

- **`resolveEffectiveScaleStep` takes BOTH values as arguments.** It never reads
  `usePreferencesStore` or `useAppSettingsStore` itself. The precedence rule is a pure function of
  its two inputs, testable with no world stood up.
- **`resolveTypographyVars` returns a MAP, not a single write.** This is the card's hard
  extensibility requirement. Adding `bodyFamily` later is one new key in this map plus one
  stylesheet rule — with zero change to the provider, the `DomPort`, the persistence plumbing, or
  the settings transport. **A hunter who hardcodes `setProperty("--kanna-font-scale", …)` in the
  provider has failed this card even with a green suite**, and the audit rejects it.

### 2.2 The stylesheet (P3, P5)

`src/index.css`, inside the existing `@layer base`:

```css
html { font-size: calc(16px * var(--kanna-font-scale, 1)); }
```

The `, 1` fallback means no-JS and pre-hydration render exactly as today.

Escape hatches, each either derived or exempted with a test:

| Site | Today | Becomes | Why |
|---|---|---|---|
| `input, textarea, select` `:190` | `font-size: 16px` | `font-size: max(16px, 1rem)` | Scales **up** only. Naive scaling would drop below 16px at `sm` and reintroduce iOS zoom-on-focus, violating the **Mobile-Input-16 Rule** (`DESIGN.md:207`). |
| `--shell-top-band` `:76` | `64px` / `55px` @md | `4rem` / `3.4375rem` | Fixed chrome height; must grow with its text or enlarged labels clip at `xxl`. Byte-identical at scale 1.0. |
| `--diffs-font-size` `:318` | `11px` | `0.6875rem` | Scales for free. |
| `code, pre` `:267`, `body` `:173`, `.font-logo` `:182` | 3 hardcoded stacks | `var(--kanna-font-body/-mono/-logo)` | Future family swap becomes a value change, not a hunt through three stacks. |

### 2.3 The px conversion — a verified byte-identity trap

The card requires `md` to be **exactly 1.0, today's rendering byte-identical**. The obvious
conversion — map `text-[16px]` to Tailwind's stock `text-base` — **breaks that**, and I verified it
by compiling Tailwind v4.3.3 directly:

```css
.text-base { font-size: var(--text-base); line-height: var(--tw-leading, var(--text-base--line-height)); }
.text-13   { font-size: var(--text-13); }          /* custom token, no paired line-height var */
.text-\[13px\] { font-size: 13px; }
```

A stock named step also sets **line-height**; the arbitrary px utility sets font-size only. Mapping
to stock steps would silently change line-height on the 32 sites whose values happen to match a
stock step (12/16/18/20px).

**Therefore: define all ten values as custom `@theme` tokens with no paired line-height var**, and
never map to stock named steps.

```css
@theme {
  /* Typography steps, named for their px size at scale 1.0 (root 16px).
     Deliberately NO --text-N--line-height pair: these must set font-size only,
     exactly like the text-[Npx] utilities they replace. */
  --text-9: 0.5625rem;  --text-10: 0.625rem;  --text-11: 0.6875rem; --text-12: 0.75rem;
  --text-13: 0.8125rem; --text-15: 0.9375rem; --text-16: 1rem;      --text-18: 1.125rem;
  --text-20: 1.25rem;   --text-22: 1.375rem;
}
```

The conversion is then a purely mechanical, uniform substitution — `text-[Npx]` → `text-N` — which
is what makes wave 4 safe to parallelize across hunters and trivial to verify.

### 2.4 Persistence — and the rule conflict it must resolve (P6)

The card mandates a **write-through localStorage cache** so the blocking script at `index.html:14`
can apply the scale pre-paint. `rule-zustand-store` states, verbatim:

> Persist only via `zustand/middleware`'s `persist` — never custom `localStorage` writes.

These collide head-on if the cache is a hand-rolled `localStorage.setItem`. They do **not** collide
under this design, which satisfies both:

- **Both persisted values live in the existing `kanna-preferences` zustand `persist` store**
  (`src/client/stores/preferences.ts`, `version: 1` → `version: 2`):
  - `typographyOverride?: FontScaleStep` — this device's override.
  - `typographyServerDefaultCache?: FontScaleStep` — a mirror of the server default.
- The zustand `persist` middleware performs every write. **No custom localStorage write exists**,
  so the rule is honored literally.
- The blocking script only ever **reads** `localStorage["kanna-preferences"]` (envelope
  `{ state, version }`), which no rule forbids — and `index.html` is not `src/client/**`, so
  `no-clientside-effects.yml` does not reach it either.

**The cache invariant, stated so the audit can check it:** `typographyServerDefaultCache` is
**write-only at runtime and read-only pre-paint**. Runtime code always reads server truth from the
WS-fed store, never from the cache. This keeps `rule-zustand-store`'s "server-derived truth lives
ONLY in the WS-fed `kannaStateStore`" intact — the cache is a pre-paint bootstrap mirror, not a
second source of truth.

### 2.5 Applying it to the DOM (P2)

`no-clientside-effects.yml` (severity `error`) bans touching `document` from `src/client/**`, so the
write goes through a **new port method**, mirroring `setBodyStyle`:

```ts
// src/client/ports/domPort.ts
/** Sets a CSS property on `document.documentElement.style` (e.g. a CSS custom property). */
setDocumentElementStyleProperty(property: string, value: string): void
```

```ts
// src/client/adapters/dom.adapter.ts
setDocumentElementStyleProperty(property: string, value: string): void {
  document.documentElement.style.setProperty(property, value)
},
```

Adding this method **breaks three typed fakes at compile time, by design** (they are declared
`const x: DomPort`, not cast — see the rationale comment at `fakePorts.ts:5-19`). All three must be
updated: `hooks/useTheme.test.ts`, `lib/testing/fakePorts.ts`,
`adapters/testing/makeFakePorts.ts` (which additionally gains a recorder map so the write is
assertable, mirroring its `bodyStyles` precedent at `makeFakePorts.ts:248`).

**The applier holds no local state.** `useTheme.tsx` is explicitly allowlisted in
`rules/no-react-usestate.yml:19`; a new file will **not** be, and we are not extending the
allowlist. The applier is therefore a store-driven effect with no `useState`: it selects the server
value from `useAppSettingsStore`, the override from `usePreferencesStore`, computes
`resolveTypographyVars(...)` purely, and writes **every entry of the returned map** through the
port. Iterating the map — rather than writing one known key — is what makes a future font-family
key require no provider change.

**It is a separate module from `useTheme`, deliberately.** Roughly ten component tests mock the
theme hook wholesale (e.g. `TextMessage.test.tsx:4-5` does
`mock.module("../../hooks/useTheme", …)` returning a three-field object). Widening
`ThemeContextValue` with typography fields would break every one of them. A standalone
`useTypography` keeps that blast radius at zero.

### 2.6 Server plumbing

`typography` is modeled as a **GROUP, never a bare scalar**: `AppSettingsSnapshot.typography?:
{ scale: FontScaleStep }`, so `bodyFamily`/`monoFamily` are later additive fields rather than a
schema migration. This costs one nested branch in `mergeAppSettingsPatch` — paid once, deliberately.

It follows the `theme` path, but `theme` is a flat scalar that rides a `...patch` spread, while a
nested group must be named explicitly at every merge site. Grounding turned up **more sites than the
card lists**, and the dangerous ones are invisible to the compiler:

**Compiler-enforced (TypeScript fails without them) — safe:**
`AppSettingsSnapshot` (`app-settings-types.ts:285`); `toSnapshot` (`app-settings.ts:888`, declared
return type); `buildInitialAppSettingsSnapshot` (`ws-router-defaults.ts:171`); the annotated
`const state: AppSettingsState` (`app-settings.ts:965`); and four test snapshot literals
(`app-settings.test.ts:44`, `ws-router-settings.test.ts:31`, `ws-router.test.ts:94`,
`server.test.ts:21`).

**Silent if missed (no type error, real data loss) — these are the traps:**

| Site | Failure mode if omitted |
|---|---|
| `app-settings.ts:859` `toFilePayload` | **Return type is inferred, not declared** — the group is simply never written to disk. The single most dangerous spot in this plumbing, precisely because its sibling `toSnapshot` *is* compiler-checked. |
| `app-settings.ts:1020` `toComparablePayload` | `shouldWrite` becomes permanently true → settings file rewritten on **every load**. |
| `app-settings.ts:101` `AppSettingsFile` | Loose on-disk type; the value never survives a read. |
| `app-settings.ts:1516` `applyPatch` merge block | Passed as a generic arg, so unchecked — group silently resets on every patch. |
| `ws-router-defaults.ts:40` server `mergeAppSettingsPatch` | Partial patch wipes sibling fields. |
| `appSettingsStore.ts:14` client `mergeAppSettingsPatch` | Same, optimistically, in the UI. |
| `app-settings-types.ts:335` `AppSettingsPatch` | The field cannot be sent at all. |

**There are three near-identical deep-merge functions, not one** — client `appSettingsStore.ts:14`,
server `ws-router-defaults.ts:40`, and `applyPatch` at `app-settings.ts:1516`. The card named only
the first. Each needs its own `typography: { ...base.typography, ...patch.typography }` block and
its own test.

**No change is needed** to `protocol.ts:173` (generic over `AppSettingsPatch`),
`ws-router-settings.ts:217` (forwards the whole patch), or `useAppGlobalState.ts:755` (also
generic). `buildAgentAppSettingsView` (`server.ts:122`) is a deliberately narrow agent-facing
projection that excludes `theme`; typography stays out of it too.

The group itself follows the **extracted-module precedent** used by `uploads`/`telemetry`/`auth`:
`src/shared/settings/typography.ts` exporting the interface, `TYPOGRAPHY_DEFAULTS`, and
`normalizeTypographySettings(value, warnings)`, with a test modeled on `uploads.test.ts`. This is
kept distinct from the pure-core module `src/shared/design/typography.ts` (§2.1): *design* resolves
scale to CSS vars, *settings* normalizes untrusted on-disk input.

## 3. Scope fence

**IN:** the `typography` settings group + per-device override; root-font-size zoom; all 169 px
conversions; the three independent scales (xterm, diffs, Lexical ×3); a Settings → General row after
Theme; a fenced Playwright harness; PR screenshot evidence; the `c3-116` doc update; correcting the
stale `CLAUDE.md:2179` Playwright claim.

**OUT (build none of these):** font-*family* selection (design for it, do not build it); pixel-diff
/ golden-image visual regression; per-component overrides; a free-form numeric px input; server-side
enforcement; **fixing `"Roboto Mono"` being referenced at `src/index.css:267` but never loaded** —
a real pre-existing bug, reported as a follow-up, not fixed here.

## 4. Testing strategy

The visual claim is decomposed into P1–P10 by the card; the plan maps every task to the propositions
it discharges. The spine of the audit is **P3 + P4 + P10** — a green `bun test` alone does **not**
discharge this card, because happy-dom has no layout engine and literally cannot observe that
anything got bigger.

**P6's pre-paint testing, resolved.** A blocking inline `<script>` cannot import a module, so the
logic cannot literally be imported from `src/shared/`. Duplicating it and testing the copy would
prove nothing about the shipped artifact. Instead the test **parses `index.html`, extracts the
inline script, and executes it** against a seeded fake `localStorage` + `documentElement`, then
asserts the resulting property map equals `resolveTypographyVars(resolveEffectiveScaleStep(...))`
computed by the pure module for the same input. This tests the shipped snippet *against the pure
oracle*, which is strictly stronger than testing a copy of it.

**The ast-grep regression lock lands last, not first.** A rule banning `text-[Npx]` in
`src/client/**` would flag all 169 existing sites the moment it lands, turning CI red for three
waves. So the **ratchet test** (`count <= CAP`, CAP starting at the true 169) is the wave-1 guard,
and the ast-grep rule is the final lock once the count reaches 0.

## 5. Evidence plan

- **P9 screenshots:** 2560×1440, chat + settings + sidebar, at `md` and `xxl`, light and dark,
  captured programmatically by the harness.
- **P10 harness:** Playwright, run **off the default CI path** (its own script; `test.yml` is not
  touched). Feasibility already proven this session: it drives the **installed Google Chrome** via
  `channel: "chrome"` — no 150MB browser download — and reports real computed font-size
  (16px → 24px at scale 1.5) plus 2560×1440 screenshots.
- **The oracle:** `scripts/verify-typography-scale.sh`, modeled on `scripts/verify-session-tabs.sh`,
  binding ast-grep → lint → typecheck → full suite with `--reporter=junit`, then `require_test` on
  **exact named tests** — because "a test file exists and passes" is too weak a gate. Plus a
  meta-test that a deliberately-broken fixture **fails** the gate.
- **Before/after:** BEFORE from a base-branch build, AFTER from the branch build, both captured by
  me, not claimed by a hunter.

## 6. Risks and rollback

| Risk | Mitigation |
|---|---|
| Mapping px → stock named steps silently changes line-height | Resolved: custom `--text-N` tokens only; the P3 test asserts no `--text-N--line-height` is ever defined. |
| Root scaling shrinks inputs below 16px → iOS zoom-on-focus | `max(16px, 1rem)`, asserted by the P3 stylesheet test. |
| Fixed `--shell-top-band` clips enlarged text at `xxl` | Derived in rem; verified in a real layout engine by P10. |
| Server value arrives over WS → full-layout reflow on every load | Pre-paint cache read by the blocking script (§2.4). |
| Four-site round-trip in `app-settings.ts`; missing one causes spurious rewrites | Each site is its own plan checklist item with its own assertion. |
| Adding a `DomPort` method breaks 3 fakes | Expected and desired; enumerated in the plan as required edits. |
| xterm is canvas and immune to CSS | `getTerminalOptions` takes the size as a parameter; a scale change must refit **and** send a PTY resize, or server terminal dimensions silently desync. |

**Rollback:** the feature is inert at `md` (scale 1.0, byte-identical rendering) and the CSS carries
a `var(..., 1)` fallback, so reverting the branch restores today's rendering exactly.

## 7. Pre-existing conditions found while grounding (NOT fixed here)

1. **`main` carries 28 uncommitted `.c3/` files** — a `c3x repair` rewrite that strips backticks
   from canonical markdown (e.g. `` `commandsForProvider` `` → `commandsForProvider`). This is the
   silent data loss `CLAUDE.md` warns about. My worktree branches from the committed SHA and is
   unaffected. `c3x check` itself writes nothing (verified: `git status .c3/` stayed clean).
   **Reported to the Shaman as a follow-up; not touched by this card.**
2. **`"Roboto Mono"` is referenced at `src/index.css:267` but never loaded** — explicitly out of
   fence per the card.
3. **`CLAUDE.md:2179` is stale** — documents a `wiki/scripts/capture-all.sh` Playwright capture that
   does not exist. In fence; corrected by this PR.
