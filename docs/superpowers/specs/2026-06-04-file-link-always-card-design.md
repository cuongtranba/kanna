# File Links Always Become Cards

**Status:** Draft
**Date:** 2026-06-04
**Author:** brainstorming session (hieplam)
**Scope:** Make every local file link in a chat transcript render as the existing clickable preview card. Drop the extension-based fork that sends `.md` / `.ts` / etc. through the external editor.

## Problem

Today, local file links in a transcript split into two behaviors based on file extension:

```
[README.md](/Users/.../README.md)        →  plain <a>, click spawns external editor
[chart.png](/Users/.../chart.png)        →  clickable card, click opens preview sheet
```

The "open in editor" branch is taken for a hard-coded list of ~50 extensions (`.md .ts .json .py .go .rs .yaml .toml .sh .env …`) plus a handful of bare filenames (`Dockerfile`, `Makefile`, …) and *any file with no extension* (`LICENSE`, `CHANGELOG`, …) — see `EDITOR_OPEN_EXTENSIONS` / `EDITOR_OPEN_FILENAMES` in `src/client/lib/pathUtils.ts:12`.

Three problems with this rule:

1. **Fails loudly when no editor is installed.** Clicking `README.md` invokes `system.openExternal` with the user's configured editor (Cursor / VS Code / Windsurf / Xcode). If that binary isn't on the machine, the click throws `"Cursor is not installed"` (`src/server/external-open.ts:239`). Most common case ("show me the README") becomes a dead end.
2. **Sends users away from the better experience.** The in-app preview sheet (`FilePreviewSheet`) already has dedicated body renderers for markdown, JSON, diffs, code, plain text. For most editor-extension files, the in-app preview reads better than Cursor's raw-text-with-syntax-highlight view. The current rule routes users *away* from it.
3. **Inconsistent mental model.** The user has no way to predict whether a click will preview or launch an editor — it depends on a hard-coded list inside Kanna.

The preview infrastructure already exists end-to-end: `LocalFileLinkCard`, `FilePreviewSheet`, and body renderers for every kind we need. The fix is a routing change, nothing else.

## Goals

- **One rule.** Every local file link in a transcript renders as a clickable card. Click opens the preview sheet that already exists.
- **No editor required.** Users with no editor never hit a failed launch from a left-click on a file.

That's it.

## Non-goals (deliberately cut from this round)

- **In-sheet "Open with" button.** Considered, scoped, then dropped. The sheet stays exactly as it is today (title + body + Share + Download). The editor-launch affordance is not relocated; it simply goes away from the per-file link.
- **`OpenExternalContext` provider.** Not needed without the in-sheet button.
- **Right-click context-menu removal.** The transcript-level right-click menu (`OpenExternalContextMenuContent` in `ChatTranscriptViewport`) stays wired as it is. After this change it is unreachable for local file links (cards do not bubble `contextmenu` to the `<a>` handler that drove it), but the code stays in place — dead, not removed. Cleanup can happen in a later, separate PR.
- **`PreviewSource.absolutePath`.** Not needed without the in-sheet button.
- **@-mention `absolutePath` plumbing.** Out of scope; the question of giving uploaded / @-mentioned files a real on-disk path belongs in a separate round if revisited.
- **Per-user setting** "default click: preview / editor". Explicitly rejected.
- **Card visual redesign.** Card UI stays identical.
- **Body renderer changes.** Untouched.
- **Navbar `OpenExternalSelect`.** Untouched. Project-folder open-in-editor remains in the chat header.

## Accepted consequence: editor users lose one-click file-open

Today, a Cursor / VS Code user clicks `[src/server/agent.ts](/abs/path/src/server/agent.ts)` in chat and lands directly on that file in their editor. After this change, the same click opens an in-app preview; if they want to edit, they go to the navbar's project-folder open, then navigate to the file inside their editor.

That is a real regression for editor users. It is accepted in this round because:

1. The most common case ("show me the README") goes from broken-or-good to always-good.
2. The least common case (jump to source code in chat) goes from one click to multiple clicks.
3. No regression for users without an editor — the broken path simply stops being broken.

If editor users push back, the recovery path is the in-sheet "Open with" button from the earlier spec draft — implementable as a follow-up without undoing this change.

## Architecture

### Surface touched

```
src/client/components/messages/shared.tsx
  └── LocalLink()
       │
       ├── if (parsedLocalLink && renderOptions.localLinkMode === "text") → styled span
       │     (UNCHANGED)
       │
       ├── if (parsedLocalLink && !shouldOpenLocalFileLinkInEditor(path))  ← drop !shouldOpen…
       │     → <LocalFileLinkCard path={...} linkText={...} />              ← always take this branch
       │     (CONDITION SIMPLIFIES TO: if (parsedLocalLink))
       │
       └── else → plain <a target="_blank" …>
             (now only for external URLs)
```

The `if (parsedLocalLink && !shouldOpenLocalFileLinkInEditor(parsedLocalLink.path))` condition becomes `if (parsedLocalLink)`. The negation and the function call go away.

### Nothing else changes

- `LocalFileLinkCard.tsx` — untouched.
- `FilePreviewSheet.tsx` — untouched.
- `ChatTranscriptViewport.tsx` — untouched. The right-click menu wiring remains in place but becomes unreachable for local file links (since cards no longer render an `<a>` with the contextmenu handler).
- `src/client/lib/pathUtils.ts` — `shouldOpenLocalFileLinkInEditor` stays (other call sites in `ChatTranscriptViewport.tsx:264` reference it; leave them).
- Server code — untouched.

### Edge cases (unchanged behavior)

- **Local link in text-mode context** (`localLinkMode === "text"`) → still renders as styled non-clickable span. `shared.tsx:430`.
- **File missing** (HEAD probe → 404) → card renders with `disabledReason="File no longer available"`. `LocalFileLinkCard.tsx:69`.
- **External URL** (not a local path) → plain `<a target="_blank" rel="noopener noreferrer">`.
- **Image / PDF / video / audio / archive** → already a card today. After the change, still a card. No delta.

## Testing

Co-located `*.test.tsx`. TDD: test in the same commit as the change.

### `LocalLink` test (new file `shared.test.tsx`)

- Renders `LocalFileLinkCard` for `.md`, `.ts`, `.json`, `Dockerfile`, `LICENSE` (extensions that previously took the editor branch). **New behavior assertion.**
- Renders `LocalFileLinkCard` for `.png`, `.pdf` (regression — already worked).
- Renders styled span when `localLinkMode === "text"` (regression).
- Renders external `<a target="_blank">` for non-local URLs (regression).

### Tests NOT to add

- "Open with" button — there is none.
- Right-click menu absence — menu is still wired; we're not asserting its presence or absence in this round.
- `PreviewSource.absolutePath` — field not added in this round.

## Risk and reversibility

- **Reversible in one diff.** Restoring the deleted `!shouldOpenLocalFileLinkInEditor(parsedLocalLink.path)` clause returns the prior behavior. No data shape changes, no protocol bump.
- **Behavior change for editor users on left-click.** Documented above as the accepted consequence. Mention in PR description.
- **No effect on subagent / agent / server code.** Pure-client change.
- **No effect on lint.** Same imports, same module shape, fewer branches.

## Self-audit

- **Layering / architecture purity.** Pure-client change in `src/client/components/messages/shared.tsx`. No new IO, no side-effect lint impact, no `*.adapter.ts` needed. ✓
- **Security invariants.** No new exposure. The path the card now handles is the same path the editor handler received today. ✓
- **Cross-section consistency.** Goals, non-goals, architecture, testing all agree on "drop the branch, nothing else". ✓
- **Scope.** Tightly bounded — one condition simplified, one test file added. Earlier round's "Open with / context / right-click removal" explicitly cut and documented in non-goals. ✓
- **Unverified claims.** All file paths and line numbers cite files read this session (`shared.tsx`, `pathUtils.ts`, `external-open.ts`, `LocalFileLinkCard.tsx`, `ChatTranscriptViewport.tsx`). ✓
- **Failure modes.** Editor not installed → no longer reached for left-click on local file links. File missing → existing 404 card state. External URL → existing new-tab `<a>`. ✓
- **Reversibility.** Single-clause revert restores prior behavior. ✓
- **YAGNI.** No new settings, no new state, no new context, no new fields. Smallest possible change that satisfies the goal. ✓
