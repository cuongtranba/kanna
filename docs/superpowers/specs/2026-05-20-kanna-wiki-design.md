# Kanna Wiki — Design Spec

**Date:** 2026-05-20
**Author:** cuongtranba
**Status:** Approved (brainstorm phase)
**Implementation:** Big-bang single PR

## 1. Purpose

Build a public documentation site for Kanna that serves three audiences simultaneously:

1. **New users** — install, first chat, basic workflows
2. **Power users** — PTY mode, OAuth pool, subagents, advanced flags
3. **Contributors** — architecture (C3), PR rules, dev workflow, ops/self-host

Site published at **https://kanna-wiki.lowbit.link** via GitHub Pages with custom domain.

## 2. Goals & Non-Goals

### Goals

- Document every shipped feature (full coverage, grouped by domain)
- Visual consistency with the Kanna app itself (shared design tokens)
- Screenshots from a real running Kanna instance (no mockups)
- Deploy automatically on `wiki/**` changes
- Searchable (client-side, no external SaaS)
- Single live version + dedicated changelog page

### Non-Goals (v1)

- i18n / translations
- Auto-generated TypeScript API reference
- Embedded interactive Kanna demos (iframe)
- Versioned docs with dropdown (single live + changelog instead)
- Search analytics
- Comment system / discussions
- Visual regression testing

## 3. Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Site framework | Astro Starlight | Modern, fast, full design control, fits "impeccable" UI/UX brief |
| Search | Pagefind (Starlight default) | Client-side, free, no external service |
| Hosting | GitHub Pages | Free, native integration |
| Deploy | `actions/deploy-pages@v4` (artifact upload) | Current GH-recommended path; no `gh-pages` branch clutter |
| Screenshots | agent-browser (Playwright-based) driving `localhost:3210` | One-shot capture, PNGs committed |
| Domain | `kanna-wiki.lowbit.link` (custom) | User-owned, branded |
| Package manager | Bun (`wiki/` is isolated workspace, own `package.json`) | Matches main repo tooling |

## 4. Site Map

```
/                                    Landing (3 path cards: New / Power / Contributor)
/getting-started/
  install                            bun install -g, requirements, platform support
  first-chat                         Open browser, create project, send turn
  oauth-pool-setup                   Add Claude OAuth token, enable PTY mode
/features/
  providers-models                   Multi-provider, OAuth pool, PTY driver, fast mode
  chat-transcript                    Rendering, diffs, terminal, uploads, slash/@, plan mode,
                                     subagents, bg tasks, auto-continue, compaction
  projects-sessions                  Sidebar, ordering, discovery, bulk import, worktree,
                                     resumption, titles
  advanced                           Self-update, expose_port MCP, mermaid, export,
                                     keybindings, password gate, PWA
  security-sandboxing                sandbox-exec, bwrap, allowlist preflight,
                                     durable approvals, password gate, OAuth-only PTY
/guides/
  user/                              Workflows, troubleshooting, FAQ
  contributing/                      C3 docs flow, PR rules to cuongtranba/kanna,
                                     lint cap ratchet, test discipline, worktrees
  ops/                               Self-host (pm2 / systemd / docker), OAuth pool admin,
                                     sandboxing toggle, env vars matrix
/changelog                           Mirrors GitHub releases (sourced from CHANGELOG.md)
/reference/
  env-vars                           Every KANNA_* flag + defaults (auto-extracted)
  keybindings                        Default bindings + customization
```

Landing page uses three "path cards" routing visitors to their audience. Sidebar mirrors the structure above, grouped by section.

## 5. Directory Layout

```
wiki/
  package.json                       Starlight + Astro + Pagefind deps
  astro.config.mjs                   site: 'https://kanna-wiki.lowbit.link', base: '/', sidebar config
  tsconfig.json
  public/
    CNAME                            Single line: kanna-wiki.lowbit.link
  scripts/
    seed-demo.ts                     Spin demo Kanna w/ KANNA_HOME=tmpdir, seed fixtures
    capture.ts                       agent-browser → localhost:3210, write PNGs
    capture-all.sh                   Orchestrator: seed → start server → capture → teardown
    extract-env-vars.ts              Scrape src/**/*.ts for process.env.KANNA_*, emit table
  src/
    content/
      docs/
        index.mdx                    Landing w/ 3 path cards + hero
        getting-started/*.md
        features/*.md
        guides/{user,contributing,ops}/*.md
        reference/*.md
        changelog.mdx                Imports root CHANGELOG.md
    assets/
      screenshots/
        dark/*.png
        light/*.png
      logo.svg                       Kanna icon (copied from assets/icon.png → SVG if available)
    styles/
      kanna-theme.css                Override Starlight tokens → Kanna app parity
    components/
      PathCard.astro                 Landing audience picker card
      FeatureGrid.astro              Feature-page grid layout
      EnvVarTable.astro              Reference table for KANNA_* vars
.github/workflows/
  wiki-deploy.yml                    Build wiki/ + deploy via actions/deploy-pages
```

`wiki/` has its own `package.json` and `node_modules`, isolated from the main repo build. Main `bun run build` and `bun test` are unaffected.

## 6. Visual Style — Kanna App Parity

Source design tokens from the Kanna client (`src/client/styles/`, Tailwind config, theme primitives). Override Starlight CSS variables in `kanna-theme.css`.

### Tokens to mirror

- **Accent:** pink `#f472b6` (primary). Secondary accent: use whatever Kanna's theme files define; if none, primary-only.
- **Surfaces:** dark `#0a0a0a` / light `#fafafa` — exact values pulled from Kanna's theme files
- **Font stack:** Kanna's UI font (likely Inter / system) — exact stack pulled from client config
- **Tabular numerics** in numeric tables (env-vars, version refs)
- **Radii + shadows:** match Kanna's card/button radius
- **Code blocks:** same syntax highlighting theme as Kanna's transcript renderer

### Components mirroring Kanna patterns

- `PathCard` — visual language of Kanna's chat cards (rounded, hover lift, accent border)
- `FeatureGrid` — sidebar-like grouping
- Callouts (note/warning/tip) — recolored with Kanna's status-indicator vocabulary (idle / running / waiting / failed)

### Impeccable review pass (implementation phase)

After scaffolding + theme applied, invoke `impeccable:impeccable` skill on:
1. Landing page
2. One feature page (`features/providers-models`)
3. One guide page (`guides/ops/`)

Iterate until visual consistency with Kanna app screenshots is tight. Not invoked during brainstorming per `superpowers:brainstorming` skill gate.

### Theme extraction

Implementation plan must include reading `src/client/styles/`, Kanna's Tailwind config, and any CSS-in-JS theme files to extract exact token values rather than guessing.

## 7. Screenshot Pipeline

### Flow

```
capture-all.sh:
  1. mkdir tmpdir; export KANNA_HOME=tmpdir
  2. bun run scripts/seed-demo.ts        # demo project, chat, canned messages, stub OAuth-pool, stub subagent
  3. start kanna server (bg) on :3210
  4. wait-for-port 3210
  5. bun run scripts/capture.ts          # agent-browser drives UI, captures shots
  6. kill kanna server; rm -rf tmpdir
```

### Shot list

Each shot in both `dark/` and `light/` variants (~32 PNGs total):

- `landing-hero` — full app w/ sidebar + transcript
- `sidebar-projects` — project groups w/ status indicators
- `composer` — slash command picker open
- `composer-mention` — @-mention picker
- `transcript-tool-call` — collapsible tool group expanded
- `transcript-diff` — inline diff viewer
- `plan-mode` — plan approval dialog
- `subagent-list` — subagents panel
- `subagent-run` — live subagent activity label
- `oauth-pool` — token pool admin modal
- `provider-switch` — provider/model picker
- `terminal-panel` — embedded xterm side panel
- `compaction-meter` — context-window meter near threshold
- `expose-port-prompt` — approval dialog
- `bulk-import` — Claude session import modal
- `self-update` — update UI w/ changelog
- Mobile variants for: landing-hero, sidebar-projects, composer, transcript-tool-call

Viewport: desktop 1440x900, mobile 390x844.

### Demo seed

- Project name: `kanna-wiki-demo`
- Chat title: `Refactor auth middleware`
- Canned user prompt + assistant text + tool calls (Read, Edit) replayed into event-store from fixture JSONL
- No real OAuth tokens — stub label `demo-token-1` in pool
- No real subagents executing — stub subagent w/ static metadata + frozen activity label
- No real project paths from user's actual `KANNA_HOME`

### Privacy guarantee

All screenshots come from the seeded demo Kanna instance running under a temporary `KANNA_HOME`. The user's real chats, projects, OAuth tokens, and file paths never appear in any committed PNG.

## 8. Deploy Workflow

`.github/workflows/wiki-deploy.yml`:

```yaml
name: Deploy Wiki

on:
  push:
    branches: [main]
    paths: ['wiki/**', '.github/workflows/wiki-deploy.yml']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: wiki
      - run: bun run build
        working-directory: wiki
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: wiki/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Path filter

Only triggers on `wiki/**` or workflow file changes. Avoids re-deploy on every `src/` push.

### Custom domain — one-time setup

- DNS provider for `lowbit.link`: add CNAME record `kanna-wiki` → `cuongtranba.github.io`
- GitHub repo Settings → Pages → Source = "GitHub Actions"
- GitHub repo Settings → Pages → Custom domain = `kanna-wiki.lowbit.link`
- Check "Enforce HTTPS" (after cert provisions, typically a few minutes)
- HTTPS via Let's Encrypt, auto-provisioned by GitHub

`wiki/public/CNAME` ensures GitHub keeps the custom domain on every deploy (otherwise `actions/deploy-pages` can wipe the Pages-settings CNAME).

### Astro config

```js
// astro.config.mjs
export default defineConfig({
  site: 'https://kanna-wiki.lowbit.link',
  base: '/',           // root, not /kanna, because custom domain
  integrations: [starlight({ /* sidebar, theme, etc. */ })],
})
```

### Screenshot job NOT in CI

Capture script runs locally — needs Kanna server + agent-browser + browser runtime. PNGs are committed. CI only builds and deploys.

## 9. Content Sourcing

To avoid drift between code and docs:

- **Feature blurbs:** extract README `## Features` section as starting point, expand per page with screenshots + usage
- **Env-var reference:** `wiki/scripts/extract-env-vars.ts` scrapes `src/**/*.ts` for `process.env.KANNA_*` accesses, cross-references CLAUDE.md, emits a committed `EnvVarTable.astro` data file
- **Changelog:** `changelog.mdx` imports root `CHANGELOG.md`
- **Contributing guide:** lifts from CLAUDE.md sections (PR rules to `cuongtranba/kanna`, C3 docs flow, lint cap ratchet, test discipline) — links CLAUDE.md as source of truth
- **Architecture notes:** link to `.c3/` docs, do not duplicate
- **Keybindings reference:** extract from `src/client/lib/keybindings/` defaults

## 10. Testing

- `wiki/` has its own `bun test` — minimal smoke test that `bun run build` produces `dist/index.html` with landing + sidebar links resolving
- Link checker: `lychee` step in CI scanning `wiki/dist` to catch broken internal links
- Visual regression: deferred (out of scope v1)
- Lint: no ESLint over `wiki/` in v1. Main repo's `bun run lint` excludes `wiki/`. Wiki content is markdown + Astro components; smoke-build catches breakage. Revisit if `wiki/` grows nontrivial TS.

## 11. Edge Cases

- **Fork rebase to upstream:** custom domain config lives in `wiki/public/CNAME` + `astro.config.mjs`, won't conflict with upstream
- **Screenshot drift:** docs include a "regenerate via `bun run capture-all`" note; committed PNGs are canonical
- **Private data leak in screenshots:** all shots from seeded demo Kanna under tmpdir `KANNA_HOME` — never the user's real environment
- **Mobile users:** Starlight responsive default + mobile-shot variants for key flows
- **Search index:** Pagefind auto-indexes at build, no manual step
- **Path conflict with existing `docs/`:** wiki lives under `wiki/`, leaves `docs/superpowers/` and `docs/plans/` untouched
- **`bun install` at repo root:** `wiki/` has its own `package.json` to keep main install lean; document in contributing guide
- **GitHub Pages 404s on refresh:** Starlight builds static HTML per route, so no SPA fallback needed
- **`base: '/'` correctness:** valid only with custom domain at root path; if domain ever changes to subpath, must update

## 12. Rollout — Big-Bang Single PR

One PR containing:

1. `wiki/` scaffold (Starlight + theme + config)
2. All landing + feature + guide + reference + changelog pages
3. Screenshot pipeline scripts + captured PNGs
4. `.github/workflows/wiki-deploy.yml`
5. CLAUDE.md update — add "Wiki" section pointing at `wiki/` and the regenerate-screenshots command
6. README.md addition — link to `https://kanna-wiki.lowbit.link`

Reviewer should:
- Verify visual consistency with Kanna app (impeccable pass done by author beforehand)
- Verify no private data in screenshots
- Spot-check at least one page per audience track
- Confirm `bun run build` succeeds in `wiki/`

Post-merge:
- Configure GitHub Pages settings + DNS as described in §8
- Verify https://kanna-wiki.lowbit.link resolves
- Verify Pagefind search works on production
