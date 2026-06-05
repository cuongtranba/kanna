# File Links Always Become Cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the file-extension branch in `LocalLink` so every parsed local file link renders as the existing clickable preview card. No new UI, no new context, no new state.

**Architecture:** Pure-client one-condition simplification in `src/client/components/messages/shared.tsx`. The negation `!shouldOpenLocalFileLinkInEditor(path)` is removed; the function and all other call sites stay untouched. The preview sheet and right-click menu wiring are not modified.

**Tech Stack:** React 19, TypeScript, Bun test, ESLint zero-warning gate.

**Spec:** `docs/superpowers/specs/2026-06-04-file-link-always-card-design.md`.

---

## File Structure

### New files
- `src/client/components/messages/shared.test.tsx` — first test file for `shared.tsx`'s `LocalLink` (none exists today).

### Modified files

| File | Change |
| --- | --- |
| `src/client/components/messages/shared.tsx` | One condition simplified inside `LocalLink`. One import potentially trimmed. ~8 lines diff. |

### NOT modified (deliberately)

- `src/client/components/messages/LocalFileLinkCard.tsx` — already does the right thing.
- `src/client/components/messages/file-preview/FilePreviewSheet.tsx` — sheet UI is the goal as-is.
- `src/client/app/ChatPage/ChatTranscriptViewport.tsx` — right-click menu stays wired (becomes unreachable for cards, but we don't clean up in this round).
- `src/client/lib/pathUtils.ts` — `shouldOpenLocalFileLinkInEditor` stays exported and stays referenced by `ChatTranscriptViewport.tsx:264`.
- Anything in `src/server/**` or `src/shared/**`.

---

## Conventions

- **Bun test runner.** `bun test src/path/to/file.test.tsx` for a single file. Imports: `import { describe, test, expect } from "bun:test"`.
- **TDD.** Test first → confirm fail → minimal impl → confirm pass → lint → commit.
- **Side-effect lint.** Pure-client change. No new IO, no new imports of `node:fs` / `Bun.*` / etc. Should be a no-op for lint.
- **Subagent resource safety.** Run only the scoped test commands listed below. Do not run `bun test` whole-repo from a subagent.
- **Commit cadence.** One commit per task. Commit messages follow `<type>(<scope>): <subject>` with the `Co-Authored-By` trailer the repo uses.

---

## Task 0: Pre-flight

**Goal:** Confirm worktree is clean and the files we'll touch start green.

**Files:** none modified.

- [ ] **Step 1: Confirm worktree state**

```bash
pwd
git branch --show-current
git status --short
```

Expected: cwd is `/Users/home/repos/kanna/.worktrees/spec+file-link-always-card`, branch is `worktree-spec+file-link-always-card`, working tree clean (the spec rename + plan are committed in the prior commit).

- [ ] **Step 2: Scoped baseline test pass**

```bash
bun test src/client/components/messages/LocalFileLinkCard.test.tsx
```

Expected: PASS. (No `shared.test.tsx` exists yet — we create it in Task 1.)

If `LocalFileLinkCard.test.tsx` fails on `main`, STOP and report (pre-existing failure, per CLAUDE.md).

- [ ] **Step 3: Lint baseline on the file we'll touch**

```bash
bunx eslint src/client/components/messages/shared.tsx
```

Expected: zero errors, zero warnings.

- [ ] **Step 4: No commit.** This task is read-only.

---

## Task 1: Drop the editor-extension branch in `LocalLink`

**Goal:** `LocalLink` always renders `LocalFileLinkCard` for any parsed local file link, regardless of extension.

**Files:**
- Modify: `src/client/components/messages/shared.tsx`
- Create: `src/client/components/messages/shared.test.tsx`

### Step 1: Write the failing test

- [ ] Create `src/client/components/messages/shared.test.tsx` with these test cases.

Adapt to the existing test harness if a different render utility is used elsewhere in this codebase — search for `render(` in adjacent message tests (`LocalFileLinkCard.test.tsx`, `UserMessage.test.tsx`) and copy the pattern.

```tsx
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test"
import { render, cleanup, screen } from "@testing-library/react"
import { TranscriptRenderOptionsProvider } from "./render-context"

// shared.tsx exports defaultMarkdownComponents (the React-Markdown components
// map). LocalLink is what `a:` resolves to inside that map. We render a
// markdown body through the same renderer LocalLink is wired into, then
// assert what comes out.
import { Markdown, defaultMarkdownComponents, defaultRemarkPlugins } from "./shared"

// Stub the HEAD probe so LocalFileLinkCard moves out of its loading state
// during the test. fetch() is browser-native in src/client/** and allowed
// by the side-effect lint.
beforeEach(() => {
  // @ts-expect-error — partial Response stub
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      headers: {
        get: (key: string) =>
          key === "Content-Type" ? "text/markdown" :
          key === "Content-Length" ? "1234" : null,
      },
    })
  )
})
afterEach(() => { cleanup() })

function renderMd(source: string) {
  return render(
    <Markdown remarkPlugins={defaultRemarkPlugins} components={defaultMarkdownComponents}>
      {source}
    </Markdown>
  )
}

describe("LocalLink — always-card routing", () => {
  test.each([
    ["README.md",   "/Users/me/proj/README.md"],
    ["index.ts",    "/Users/me/proj/src/index.ts"],
    ["pkg.json",    "/Users/me/proj/package.json"],
    ["Dockerfile",  "/Users/me/proj/Dockerfile"],
    ["LICENSE",     "/Users/me/proj/LICENSE"],
  ])("renders a file card for [%s](%s)", (label, path) => {
    renderMd(`[${label}](${path})`)
    expect(screen.getByTestId("local-file-link")).toBeTruthy()
  })

  test("renders a file card for image links (regression)", () => {
    renderMd("[chart.png](/Users/me/proj/chart.png)")
    expect(screen.getByTestId("local-file-link")).toBeTruthy()
  })

  test("renders styled span (no card) when localLinkMode is text", () => {
    render(
      <TranscriptRenderOptionsProvider value={{ localLinkMode: "text" }}>
        <Markdown remarkPlugins={defaultRemarkPlugins} components={defaultMarkdownComponents}>
          {"[README.md](/Users/me/proj/README.md)"}
        </Markdown>
      </TranscriptRenderOptionsProvider>
    )
    expect(screen.queryByTestId("local-file-link")).toBeNull()
    expect(screen.getByText("README.md")).toBeTruthy()
  })

  test("renders external <a target=_blank> for non-local href (regression)", () => {
    renderMd("[anthropic](https://anthropic.com)")
    const anchor = screen.getByText("anthropic").closest("a")
    expect(anchor?.getAttribute("target")).toBe("_blank")
    expect(screen.queryByTestId("local-file-link")).toBeNull()
  })
})
```

**Two facts to verify before pressing Step 2:**

1. `Markdown`, `defaultMarkdownComponents`, `defaultRemarkPlugins`, `TranscriptRenderOptionsProvider` are exported from the imports above. If any aren't exported, look at `src/client/components/messages/UserMessage.tsx:99` for the in-tree usage pattern — that file already uses `<Markdown remarkPlugins={defaultRemarkPlugins} components={defaultMarkdownComponents}>` so the symbols exist; add missing `export` keywords in `shared.tsx` rather than restructuring the test.
2. `TranscriptRenderOptionsProvider`'s prop is `value: TranscriptRenderOptions`. The full shape may need more than `localLinkMode`. Open `src/client/components/messages/render-context.tsx` and spread the defaults if the type complains:
   ```tsx
   import { DEFAULT_RENDER_OPTIONS } from "./render-context"
   <TranscriptRenderOptionsProvider value={{ ...DEFAULT_RENDER_OPTIONS, localLinkMode: "text" }}>
   ```

### Step 2: Run the test to confirm it fails

- [ ] Run:

```bash
bun test src/client/components/messages/shared.test.tsx
```

Expected: FAIL — the 5 `test.each` cases assert `local-file-link` but the current code routes those extensions through a plain `<a>` (no `data-testid="local-file-link"`). The image / text-mode / external tests should already PASS.

If the 5 always-card tests already pass, somebody else made the change — STOP and reconcile before proceeding.

### Step 3: Drop the branch in `shared.tsx`

- [ ] Locate `LocalLink` in `src/client/components/messages/shared.tsx` (around line 420). Find this block (around line 438):

```tsx
if (parsedLocalLink && !shouldOpenLocalFileLinkInEditor(parsedLocalLink.path)) {
  const linkText = extractTextFromNode(children).trim()
  return <LocalFileLinkCard path={parsedLocalLink.path} linkText={linkText || undefined} />
}
```

Replace it with:

```tsx
if (parsedLocalLink) {
  const linkText = extractTextFromNode(children).trim()
  return <LocalFileLinkCard path={parsedLocalLink.path} linkText={linkText || undefined} />
}
```

**That is the only edit in `shared.tsx`.** The plain `<a>` block below it and the right-click `onContextMenu` handler stay exactly as they are — they still need to run for external URLs and for the text-mode-styled local-link path above them.

### Step 4: Trim the import (if it became unused)

- [ ] Search inside `shared.tsx` for remaining references to `shouldOpenLocalFileLinkInEditor`:

```bash
grep -n "shouldOpenLocalFileLinkInEditor" src/client/components/messages/shared.tsx
```

If the only remaining reference is in the `import` statement on line 36, remove just that symbol from the import so the line becomes:

```tsx
import { isAbsoluteLocalFilePath, parseLocalFileLink, toLocalFileUrl } from "../../lib/pathUtils"
```

(The function stays exported from `pathUtils.ts` — `ChatTranscriptViewport.tsx:264` and the function's own test continue to use it.)

If grep finds any other reference inside `shared.tsx`, leave the import alone.

### Step 5: Run tests to confirm pass

- [ ] Run:

```bash
bun test src/client/components/messages/shared.test.tsx
```

Expected: PASS — all 9 cases (5 `test.each` + image + text-mode + external + the spread-out always-card).

Then run the existing `LocalFileLinkCard` test to confirm no regression downstream:

```bash
bun test src/client/components/messages/LocalFileLinkCard.test.tsx
```

Expected: PASS, no regressions.

### Step 6: Lint

- [ ] Run:

```bash
bunx eslint src/client/components/messages/shared.tsx src/client/components/messages/shared.test.tsx
```

Expected: zero errors, zero warnings. If the unused `shouldOpenLocalFileLinkInEditor` import slipped through, lint will catch it — remove and rerun.

Do NOT add `eslint-disable` comments (CLAUDE.md side-effect-lint section).

### Step 7: Commit

- [ ] Run:

```bash
git add src/client/components/messages/shared.tsx src/client/components/messages/shared.test.tsx
git commit -m "$(cat <<'EOF'
feat(messages): always render LocalFileLinkCard for parsed local file links

Drop the EDITOR_OPEN_EXTENSIONS fork in LocalLink. Every local file link
in a transcript now renders as a clickable card that opens the in-app
preview sheet — including .md, .ts, .json, Dockerfile, LICENSE, and the
other ~50 entries that previously took the external-editor path.

Fixes the "Cursor is not installed" hard fail on the most common ask
("show me the README"). The editor-launch affordance for individual
files is removed in this round; the navbar's project-folder Open With
remains for editor users. Right-click menu wiring in
ChatTranscriptViewport is left intact (now unreachable for cards) and
can be cleaned up in a follow-up PR.

Spec: docs/superpowers/specs/2026-06-04-file-link-always-card-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Verify (full lint + scoped tests + manual smoke)

**Goal:** Confirm the change holds up against the project's CI gates and behaves correctly in the browser.

**Files:** none modified.

### Step 1: Full lint sweep

- [ ] Run:

```bash
bun run lint
```

Expected: zero errors, zero warnings.

If the warning count dropped below the cap, lower the cap in the same PR per CLAUDE.md (ratchet rule). If it dropped because of this change, that's a bonus — note it in the PR description.

### Step 2: Scoped test pass

- [ ] Run:

```bash
bun test \
  src/client/components/messages/shared.test.tsx \
  src/client/components/messages/LocalFileLinkCard.test.tsx \
  src/client/components/messages/file-preview/
```

Expected: all PASS, zero skipped.

### Step 3: Full test pass

- [ ] Run:

```bash
bun test
```

Expected: all PASS, zero skipped. This is the CI gate per project CLAUDE.md.

If any pre-existing tests fail (unrelated to this change), STOP and report per the "Pre-existing Issues" rule.

### Step 4: Manual UI smoke

- [ ] Run:

```bash
bun run dev
```

Open Kanna in the browser. In a chat, paste this markdown into the composer and send:

```
Here are a few files:

- [README.md](/Users/home/repos/kanna/README.md)
- [package.json](/Users/home/repos/kanna/package.json)
- [src/client/app/ChatPage/index.tsx](/Users/home/repos/kanna/src/client/app/ChatPage/index.tsx)
- [chart-icon.png](/Users/home/repos/kanna/assets/icon.png)
- [anthropic](https://anthropic.com)
```

Then verify:

1. README.md renders as a file card with the Markdown icon + "Markdown · …" subtitle.
2. Click the README card → preview sheet opens with the rendered markdown. ✕ closes it.
3. package.json renders as a file card → click opens preview with `JsonBody`.
4. index.tsx renders as a file card → click opens preview with `CodeBody` (TypeScript highlighted).
5. icon.png renders as a file card → click opens preview with `ImageBody` (regression).
6. `anthropic` link renders as a styled external link → click opens https://anthropic.com in a new tab (regression).
7. No "Cursor is not installed" error appears anywhere.

If anything fails the smoke, STOP, file an issue describing the failure mode, and revert Task 1's commit so the worktree returns to a green baseline.

### Step 5: No commit.

This task is verification only. Task 1's commit is the entirety of the change.

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
| --- | --- |
| Drop the `!shouldOpenLocalFileLinkInEditor` clause in `LocalLink` | Task 1 step 3 |
| Always render `LocalFileLinkCard` for parsed local file links | Task 1 step 3 (post-edit assertion + tests) |
| `LocalFileLinkCard`, `FilePreviewSheet`, `ChatTranscriptViewport`, `pathUtils.ts`, server — untouched | Implicit (no task modifies them) |
| Edge cases unchanged (text-mode span, missing-file state, external URL, image/pdf cards) | Task 1 step 1 (tests assert) |
| Pure-client, no IO, no lint regression | Task 2 step 1 |
| Reversible in one diff | Task 1 commit is single-file in the touched module |

Gap check: no spec section without a task. No task without a spec anchor.

**2. Placeholder scan**

No `TBD` / `TODO` / "implement later" / "similar to" placeholders. Every code block is the literal content the engineer types. Every command has its expected output. The "two facts to verify" note inside Task 1 Step 1 is a deliberate sanity check, not a placeholder — both paths (symbols exported, symbols not exported) are spelled out with concrete remediation.

**3. Type consistency**

The only types touched are React-Markdown component props which are not changed by this plan. `LocalFileLinkCard` props (`path`, `linkText?`) are passed as before — no rename. No new types introduced.

**4. Scope vs. spec non-goals**

Plan does not introduce any of the spec's explicit non-goals: no `OpenExternalContext`, no `PreviewSource.absolutePath`, no in-sheet "Open with" button, no right-click menu removal. Plan matches the spec's "minimal change" framing.

**Self-audit clean.**

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-04-file-link-always-card.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute the 2 tasks here in this session, batch checkpoints.

**Which approach?**
