# File Links Always Become Cards — "Open with" Moves Into the Preview Sheet

**Status:** Draft
**Date:** 2026-06-04
**Author:** brainstorming session (hieplam)
**Scope:** Make every local file link in a transcript a clickable preview card. Move the editor-launch affordance from a plain-link click into the preview sheet header.

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

The preview infrastructure already exists: `LocalFileLinkCard`, `FilePreviewSheet`, and body renderers for every kind we need. The fix is a routing change, not new UI.

## Goals

- **One rule.** Every local file link in a transcript renders as a clickable card. Click opens the preview sheet.
- **"Open with" moves into the sheet.** Reuse the existing `OpenExternalSelect` component (the blue editor icon + chevron from the navbar) inside the sheet header, scoped to the specific file path. Users who want their editor still get it — one extra click.
- **Navbar untouched.** The project-folder `OpenExternalSelect` in `ChatNavbar` keeps targeting the chat's working directory. Folder-open is a real, separate action.
- **No editor required.** Users with no editor never hit a failed launch from a left-click on a file.

## Non-goals

- Changing `OpenExternalSelect` itself, its menu items, or editor-preset detection.
- Changing the navbar.
- Changing the preview body renderers (`MarkdownBody`, `CodeBody`, `JsonBody`, `TextBody`, `ImageBody`, `PdfBody`, `AudioBody`, `VideoBody`, `TableBody`).
- Adding a new user setting ("prefer preview / prefer editor"). One rule, per-file choice.
- Touching `parseLocalFileLink` or `isAbsoluteLocalFilePath`. Same parse, different render.
- Re-styling the file card or the sheet beyond adding one header button.

## Architecture

### Surfaces touched

```
src/client/components/messages/shared.tsx
  └── LocalLink()                          drop the editor-extension branch;
                                           always render LocalFileLinkCard

src/client/components/messages/LocalFileLinkCard.tsx
  └── (small) accept editor props OR pull
      them from a context provider; pass
      them down to FilePreviewSheet

src/client/components/messages/file-preview/FilePreviewSheet.tsx
  └── sheet header                         add OpenExternalSelect as a new
                                           leftmost button; wire to the same
                                           handleOpenLocalLink the navbar uses

src/client/app/ChatPage/ChatTranscriptViewport.tsx
  └── remove the right-click ContextMenu
      that today shows the "Open with" menu
      at the click position;
      pass editor props / handler to the
      message tree (via context provider)

src/client/lib/pathUtils.ts
  └── shouldOpenLocalFileLinkInEditor()    KEEP the function (other callers
                                           may exist); just stop calling it
                                           from LocalLink and from
                                           handleOpenLocalLinkClick. Delete
                                           only after grep confirms zero
                                           references.
```

No new files. No protocol bump. No event-store migration. No shared-types change.

### Data flow after the change

```
TRANSCRIPT — single routing rule for every local file link:

  shared.tsx → LocalLink(href)
                    │
                    │ parseLocalFileLink(href)
                    ├─ external URL              → <a target="_blank">
                    ├─ local + text-mode         → styled span (existing)
                    └─ local + clickable         → <LocalFileLinkCard path={...} />
                                                   (NO editor-extension fork)

CARD — already exists, condition simplified:

  LocalFileLinkCard
       │
       ├─ HEAD probe → mime + size
       └─ AttachmentFileCard onClick={() => setPreviewOpen(true)}
              │
              ▼
       <FilePreviewSheet source open ... />

SHEET — new header button added:

  Sheet header buttons:  [📝 Open with ▾]  [↓ Download]  [↗ Share]  [✕ Close]
                              │
                              │ chevron click → menu (existing
                              │                       OpenExternalContextMenuContent)
                              ▼
                       items: Cursor / VS Code / Windsurf / Xcode /
                              Open in default / Reveal in Finder
                              │
                              │ select
                              ▼
                       onOpenExternal(action, editor)
                              │
                              ▼ (path = the previewed file, not the project folder)
                       handleOpenLocalLink({ path, action, editor })
                              │
                              ▼
                       ws.send { type: "system.openExternal", action, path, editor }
                              │
                              ▼
                       server/external-open.ts → spawn editor / open / reveal
                              │
                              ├─ success → editor opens; sheet stays open
                              └─ rejected → toast("Cursor is not installed");
                                           sheet stays open; preview stays visible
```

### Threading editor info down to the sheet

The sheet currently receives only the file source as a prop. To render `OpenExternalSelect` it needs:

- `editorPreset: EditorPreset` (from `useTerminalPreferencesStore`)
- `editorCommandTemplate: string`
- `platform: "darwin" | "linux" | undefined`
- `onOpenExternal: (target, action, editor) => void` (today's `handleOpenLocalLink`)

Two options for wiring:

| Option | Approach | Cost |
|---|---|---|
| **a. Prop drilling** | Pass props through `LocalFileLinkCard` → `FilePreviewSheet` from `ChatTranscriptViewport`. | 2 levels of drilling; small but mechanical. |
| **b. New context** | Add `OpenExternalContext` provider next to `OpenLocalLinkContext` (same pattern as today). | One new file (~20 lines); zero drilling. |

**Recommendation: b.** It matches the existing `OpenLocalLinkContext` pattern in the same file (`shared.tsx:54`), avoids drilling into every `LocalFileLinkCard` instance, and the sheet reads a single context value. Negligible cost over option a.

### Right-click context menu — remove

Today, right-click on a file link pops `OpenExternalContextMenuContent` at the cursor (`ChatTranscriptViewport.tsx:262-283, 388-414`). With the sheet now exposing the same menu via the header button, the right-click is redundant.

**Decision: remove the transcript-level right-click menu.** One way to do things — the sheet has the same menu. If users miss it, re-add later as a separate PR.

State to delete: `localLinkMenuTriggerRef`, `localLinkMenuTarget`, the hidden `<span>` trigger, the `<ContextMenu>` wrapper, and the `setLocalLinkMenuTarget(...)` branch inside `handleOpenLocalLinkClick`. The `onContextMenu` handler inside `LocalLink` in `shared.tsx` also goes away (cards don't need it).

### Error handling

When the spawned editor isn't installed, `system.openExternal` rejects with an `Error` whose message includes the editor name (`"Cursor is not installed"`, etc.). The sheet:

1. Stays open.
2. The preview body keeps rendering — the user still sees the file.
3. A toast surfaces the error using the app's existing toast pattern (`useToast` / `sonner` — confirm at implementation time).

No inline banner inside the sheet. The error is transient and the file is still readable; a toast is the right weight.

### Edge cases (unchanged behavior)

- **Local link in text-mode context** (`localLinkMode === "text"`) → still renders as styled non-clickable span. No change. `shared.tsx:430`.
- **File missing** (HEAD probe → 404) → card renders with `disabledReason="File no longer available"`. No change. `LocalFileLinkCard.tsx:69`.
- **External URL** (not a local path) → plain `<a target="_blank" rel="noopener noreferrer">`. No change.
- **Image / PDF / video / audio / archive** → already a card today. After the change, still a card. The only delta on these files is the new "Open with" button in the sheet header (which they didn't have before — they previously had Share + Download only).

## Testing

Co-located `*.test.tsx` next to each touched file. TDD: tests in the same commit as the change.

### `shared.test.tsx` (or equivalent for `LocalLink`)

- Renders `LocalFileLinkCard` for `.md`, `.ts`, `.json`, `.py`, `Dockerfile`, `LICENSE` (extensions that previously took the editor branch). **New behavior assertion.**
- Renders `LocalFileLinkCard` for `.png`, `.pdf` (regression — already worked).
- Renders styled span when `localLinkMode === "text"` (regression).
- Renders external `<a>` for non-local URLs (regression).
- Does **not** render a `<a>` with an `onClick` editor-spawn handler for any local path (regression-prevention for the deleted branch).

### `FilePreviewSheet.test.tsx`

- Header contains an `OpenExternalSelect` button.
- Clicking the editor icon dispatches `onOpenExternal(target, "open_editor", undefined)` with `target.path` equal to the sheet's previewed file.
- Selecting a non-default editor from the chevron menu dispatches with `editor: { preset: "vscode", ... }` (or whichever was picked).
- When `onOpenExternal` rejects, the sheet stays mounted (`onOpenChange` is NOT called with `false`).
- A toast surfaces the rejection message.

### `ChatTranscriptViewport.test.tsx`

- The hidden `localLinkMenuTrigger` `<span>` and `<ContextMenu>` are no longer in the rendered tree (regression-prevention for the deleted right-click flow).
- An `OpenExternalContext` provider wraps the message tree with the chat's editor settings and `handleOpenLocalLink`.

### Tests to **delete**

- Any existing test that asserts a `.md` / `.ts` / etc. link renders as `<a>` rather than as a card. That behavior is intentionally removed.
- Any existing test that asserts the right-click menu opens.

## Risk and reversibility

- **Reversible in one diff.** Restoring the `shouldOpenLocalFileLinkInEditor(path)` branch in `LocalLink` and rolling back the sheet header restores the old behavior. No data shape changes.
- **Behavior change for editor users on left-click.** `README.md` no longer spawns Cursor on first click; it opens the preview sheet first, with "Open with" one click away. Flag in PR description; mention in user-facing changelog.
- **Right-click loss.** Power users who right-clicked links to skip the menu now go through the sheet. Mention in changelog; happy to re-add as a separate PR.
- **No effect on subagent / agent / server code.** Pure-client change.

## Out-of-scope follow-ups (note for later, do not include)

- Per-user setting "default click action: preview / editor" — explicitly rejected this round (one rule, per-file choice).
- Generalizing card rendering to plain-text path mentions like `src/server/foo.ts:42` (not just markdown links) — separate brainstorm. The current spec only changes routing for already-parsed markdown links.
- Telemetry on "Open with" usage — out of scope.

## Self-audit

- **Layering / architecture purity.** Pure-client change in `src/client/**`. No new IO, no side-effect lint impact, no `*.adapter.ts` needed. ✓
- **Security invariants.** No new secrets, no new exposure. `system.openExternal` is server-mediated and already validates inputs; the file path it now receives is one the user can already see in their own transcript. ✓
- **Cross-section consistency.** "Always card" is applied uniformly: routing, sheet, tests. No section silently keeps the old extension rule. ✓
- **Scope.** Stays inside "clickable file card + preview" — doesn't grow into a broader file-affordance redesign. ✓
- **Unverified claims.** Code references cite files actually read this session (`shared.tsx`, `LocalFileLinkCard.tsx`, `FilePreviewSheet.tsx`, `ChatTranscriptViewport.tsx`, `pathUtils.ts`, `external-open.ts`, `ChatNavbar.tsx`). ✓
- **Failure modes.** Editor not installed → toast + preview stays. File missing → existing 404 card state. External URL → existing new-tab `<a>`. ✓
- **Reversibility.** Single-file rule revert restores prior behavior; no data migration needed. ✓
- **YAGNI.** No new settings, no new global state, no telemetry. New context provider only because the existing wiring already uses one for the sibling `OpenLocalLinkContext` — same pattern, not a speculative abstraction. ✓
