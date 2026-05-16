# Mobile-First Universal File Preview — Design

**Status:** Draft
**Date:** 2026-05-16
**Author:** brainstorming session (cuongtranba)
**Scope:** Replace fragmented file-preview surfaces with one mobile-first sheet primitive that covers every file kind across every chat origin.

## Problem

Today Kanna shows file content through three disconnected paths:

- `AttachmentPreviewModal` — used by `UserMessage` and `LocalFileLinkCard`. Radix `Dialog`, desktop-centric, no audio/video/code support, `100vh` height breaks on iOS Safari.
- `OfferDownloadMessage` — `AttachmentFileCard` with `href`/`download` only. No preview; clicking just saves bytes even when the file is something the modal could render.
- `ImageGenerationMessage` — bespoke inline `<img>` + `<figure>` markup, bypasses the modal entirely.

90% of Kanna users work on phones. The current paths leak content into new tabs, force downloads for files the user only wants to glance at, and never opens a sheet sized for thumbs. Audio/video/source code with syntax highlighting are not supported anywhere.

## Goals

- Single mobile-first sheet primitive used by all four origins.
- Lazy fetch — never block transcript scroll on file bytes.
- Native share for every kind; download retained only where the tool's purpose is delivering bytes.
- Add audio, video, syntax-highlighted source to the supported kinds.
- Zero new runtime dependencies; Shiki dynamic-imported behind code body.

## Non-Goals

- Explicit close affordance (X button) and Android hardware-back integration — rejected this round. Swipe-down is the only dismiss gesture besides Radix-provided ESC/backdrop.
- Pinch-zoom / pan via JS gesture libraries — rely on CSS `touch-action: pinch-zoom` for images.
- Bottom-sheet libraries (vaul, etc.) — full-screen + plain pointer events suffices.
- Telemetry — no metrics emitted in initial impl.

## Architecture

New directory: `src/client/components/messages/file-preview/`

```
file-preview/
├── FilePreviewSheet.tsx        container — mobile full-screen, desktop ≥768px centered
├── InlinePreviewCard.tsx       factory — picks body via classifyAttachmentPreview
├── useViewportFetch.ts         IntersectionObserver hook for lazy snippet fetch
├── actions.ts                  shareViaWebShare, downloadFile
├── types.ts                    PreviewSource discriminated union
└── bodies/
    ├── ImageBody.tsx
    ├── PdfBody.tsx
    ├── MarkdownBody.tsx
    ├── TableBody.tsx
    ├── TextBody.tsx
    ├── JsonBody.tsx
    ├── AudioBody.tsx
    ├── VideoBody.tsx
    └── CodeBody.tsx            dynamic import('shiki') with plain-text fallback
```

Reuse from `src/client/components/messages/attachmentPreview.ts`: `classifyAttachmentPreview`, `classifyAttachmentIcon`, `fetchTextPreview`, `parseDelimitedPreview`, `prettifyJson`, `TEXT_PREVIEW_LIMIT_BYTES`.

Deprecate after migration: `AttachmentPreviewModal.tsx`.

Call sites migrated (4):

- `UserMessage.tsx` — swap modal → sheet.
- `LocalFileLinkCard.tsx` — swap modal → sheet.
- `OfferDownloadMessage.tsx` — wrap `AttachmentFileCard` with `InlinePreviewCard`, mount sheet with `origin="offer_download"` so the Download action remains visible.
- `ImageGenerationMessage.tsx` — replace inline `<img>` + `<figure>` with `InlinePreviewCard kind="image"` + sheet; caption (`revisedPrompt`) stays below the card.

### PreviewSource

The single abstraction unifying all four origins:

```ts
type PreviewOrigin =
  | "user_attachment"
  | "local_file_link"
  | "offer_download"
  | "image_generation"

interface PreviewSource {
  id: string
  contentUrl: string
  displayName: string
  fileName: string
  relativePath?: string
  mimeType: string
  size?: number
  origin: PreviewOrigin
}
```

`origin` drives footer action visibility. `download` button shows only when `origin === "offer_download"`.

### Responsive rule

- viewport `<768px` → full-screen (`inset-0`, drag handle, swipe-down dismiss, `100dvh`).
- viewport `≥768px` → centered modal (`max-w-3xl`, `max-h-[90dvh]`, ESC/backdrop dismiss).

Single component, Tailwind responsive utilities. No conditional component split.

### Bundle impact

- No new deps.
- Shiki dynamic `import()` only inside `CodeBody` → split chunk, ~150 KB lazy on first code preview.
- Plain `<pre>` fallback on import failure or unknown language.

## Components

### `FilePreviewSheet`

```ts
interface Props {
  source: PreviewSource | null
  open: boolean
  onOpenChange: (open: boolean) => void
}
```

- Radix `Dialog.Root` for portal + focus trap + ESC.
- `Dialog.Content` classes: `inset-0 md:inset-auto md:max-w-3xl md:max-h-[90dvh]`.
- Mobile drag handle: `<div role="button" aria-label="Drag down to close" className="h-1 w-12 mx-auto rounded-full bg-muted">`.
- Swipe-down: pointer events on header area only. Track `dy`, apply `transform: translateY(dy)` to Content. Release if `dy > 120 || velocity > 0.5` → `onOpenChange(false)`. Velocity = `dy / dt` from last 100 ms.
- Pointer events skipped if `event.target` is inside `<pre>`, `<table>`, `.markdown-body` to preserve text selection.
- Body slot: `classifyAttachmentPreview(source)` → render matching `*Body`.
- Footer: `<ShareButton>` always; `<DownloadButton>` only when `source.origin === "offer_download"`.

### `InlinePreviewCard`

```ts
interface Props {
  source: PreviewSource
  onOpen: () => void
  variant: "compact" | "expanded"
}
```

`classifyAttachmentIcon(source)` picks card render style:

- **image** → `<img loading="lazy">` thumbnail, `max-h-64`.
- **audio** → icon + waveform-style placeholder strip.
- **video** → `<video preload="metadata">` first-frame poster + play overlay.
- **pdf** → icon + "PDF · {size}" meta chip.
- **markdown / text / json / table / code** → icon + snippet from `useViewportFetch`. Hook fetches up to 4 KB; card displays the first ~200 characters (or first 5 rows for table) clamped via CSS `line-clamp-3`.
- **archive / file** → icon + meta chip only.

Whole card clickable → `onOpen()`. Loading skeleton shimmer while pending. Error state: icon + "Unable to preview" + Open link fallback.

### `useViewportFetch`

```ts
function useViewportFetch<T>(opts: {
  ref: RefObject<HTMLElement>
  enabled: boolean
  fetcher: (signal: AbortSignal) => Promise<T>
}): {
  state: "idle" | "loading" | "ready" | "error"
  data: T | null
  error: Error | null
}
```

- IntersectionObserver, root margin `200px` (slight prefetch).
- Once `isIntersecting`, fires fetcher with `AbortController`.
- Unmount aborts in-flight.
- Module-level `Map<sourceId, T>` cache shared across cards.
- Returns memoised object keyed by state to remain stable-ref per CLAUDE.md render-loop rule.

### `actions.ts`

```ts
async function shareViaWebShare(source: PreviewSource): Promise<"shared" | "copied" | "failed">
function downloadFile(source: PreviewSource): void
```

`shareViaWebShare`: `navigator.share({title, url})` when available; falls back to `navigator.clipboard.writeText(contentUrl)`. Rejection with `AbortError` (user dismissed share) → silent. Other rejections → toast "Share failed, link copied" + clipboard.

`downloadFile`: creates `<a href download={source.fileName}>`, clicks, removes.

### Body responsibilities

All bodies take `{ source: PreviewSource }`. Each owns its own AbortController + cache key.

| Body | Render | Fetch |
|------|--------|-------|
| `ImageBody` | `<img>` `object-contain` `touch-action: pinch-zoom` | none — browser fetches |
| `PdfBody` | desktop `<iframe sandbox="allow-same-origin allow-scripts">`; mobile `<a target="_blank">` + "Open PDF externally" CTA | none |
| `AudioBody` | `<audio controls preload="metadata">` + filename + duration | none |
| `VideoBody` | `<video controls playsInline preload="metadata" className="max-h-[60dvh]">` | none |
| `MarkdownBody` | `react-markdown` + `remarkGfm`, anchors forced `target="_blank" rel="noopener noreferrer"` | `fetchTextPreview` (1 MB) |
| `TableBody` | sticky `<thead>`, horizontal scroll wrapper | `fetchTextPreview` + `parseDelimitedPreview` |
| `TextBody` | monospace `<pre>` `whitespace-pre-wrap` | `fetchTextPreview` |
| `JsonBody` | `prettifyJson` + `<pre>` | `fetchTextPreview` |
| `CodeBody` | Shiki `codeToHtml` (theme `github-dark`); plain `<pre>` fallback; skip highlight if content > 200 KB | `fetchTextPreview` + dynamic `import("shiki")` |

## Data Flow

```
Origin adapter builds PreviewSource
        ↓
<InlinePreviewCard source={...} variant=... onOpen={openSheet}>
        ↓ (ref attached)
useViewportFetch observes ref
        ↓ in viewport
state=loading → fetcher(signal)
  image/audio/video/pdf: HEAD only
  md/txt/json/code:      fetchTextPreview(url, 4 KB)
  table:                 fetchTextPreview(url, 4 KB) + parse first 5 rows
        ↓
state=ready → render card content
        ↓ user taps
parent setOpen(true), setSource(source)
        ↓
<FilePreviewSheet open source>
        ↓
classifyAttachmentPreview → pick body
        ↓
<*Body> fetches FULL content
        ↓
Footer actions: Share always; Download iff origin=offer_download
        ↓ swipe-down OR backdrop OR ESC
onOpenChange(false)
```

### Caching

Three independent layers:

1. **Card snippet cache** — module `Map<sourceId, snippet>` inside `useViewportFetch`.
2. **Body full-fetch cache** — module `Map<sourceId, PreviewState>` inside text bodies.
3. **Browser HTTP cache** — `<img>/<video>/<audio>/<iframe>` rely on `Cache-Control` response headers.

Snippet and full fetch do not share bytes — 4 KB vs 1 MB targets.

### Concurrency

- Each `useViewportFetch` owns its `AbortController`; unmount aborts.
- Body fetch on sheet close is NOT aborted — let it populate cache for cheap reopen.
- Sheet open → close → reopen mid-fetch: second open subscribes via cache entry `state="loading"`; no duplicate request.
- Source change while sheet open: `key={source.id}` on body remounts; old aborted.

## Error Handling

| Stage | Failure | UI | Recovery |
|-------|---------|----|----------|
| Card HEAD | 404 | "File missing" badge, card non-clickable | none |
| Card HEAD | timeout 10 s | "Preview unavailable" + Retry | Retry refires fetcher |
| Card HEAD | 5xx | "Server error" + Retry | exponential backoff 1/3/8 s, max 3 |
| Snippet fetch | abort (unmount) | silent | n/a |
| Snippet fetch | parse fail | render icon-only card | tap still opens sheet |
| Body fetch | timeout 15 s | error block + actions still visible | Retry button |
| Body fetch | 413 / too large | "File too large (X MB). Open externally." | external link CTA |
| `<img>` onerror | broken | error icon + filename | actions still work |
| `<audio>/<video>` error event | codec/network | "Unable to play. Download instead." | Download promoted to primary |
| Shiki import reject | network/chunk | plain `<pre>` fallback, `console.warn` once per session | silent |

### Mobile-specific

- `100dvh` (dynamic viewport height) replaces `100vh` — fixes iOS Safari URL bar covering content. Pre-existing bug in current modal, documented in PR.
- Swipe-down pointer events bound to drag handle + header strip only, not body — preserves iOS rubber-band scroll and text selection inside `<pre>`/`<table>`/`.markdown-body`.
- Orientation change: `100dvh` re-measures automatically.
- Landscape phone: `max-h-[80dvh]` on image/video so header strip stays reachable.
- Slow 3G: snippet (4 KB) negligible; body fetch shows progress indicator after 3 s.
- `preload="metadata"` on audio/video prevents iOS Safari auto-downloading full bytes.
- Shiki tokenisation guarded — skip highlight if content > 200 KB to avoid frame drop on cheap Android.

### Security

- `contentUrl` validated via existing `buildProjectFileContentUrl` (project root enforced).
- `navigator.share({url})` shares URL only, never blobs. `LocalFileLinkCard` uses `toLocalFileUrl` which yields HTTP route, not `file://`.
- `<iframe>` for PDF: `sandbox="allow-same-origin allow-scripts"`. No `allow-top-navigation`.
- Markdown rendered via `react-markdown` (no `dangerouslySetInnerHTML`, no `rehype-raw`).
- Markdown anchors forced `target="_blank" rel="noopener noreferrer"` via custom `components.a`.
- No `eval`, no template-string HTML injection.

### Origin-specific quirks

| Origin | Quirk | Handling |
|--------|-------|----------|
| `image_generation` | `result` undefined while `status="in_progress"` | guard in `ImageGenerationMessage`; build source only on `status="completed"` |
| `local_file_link` | path may be deleted between probe and tap | body refetches; 404 → error block |
| `offer_download` | label may differ from fileName | `displayName = label || fileName`; `fileName` stays canonical for `<a download>` |
| `user_attachment` | attached during streaming | source built from `ChatAttachment`; size known upfront |

### A11y (within swipe-only constraint)

- `Dialog.Title` mandatory — screen reader announces filename on open.
- `Dialog.Description` = MIME · size · origin label.
- Focus moves to body region on open. ESC dismiss free via Radix.
- Drag handle `role="button" aria-label="Drag down to close"` — announced even though SR cannot gesture-swipe; ESC remains the SR exit.
- Body region `role="region" aria-label="File preview"`.
- Footer buttons proper `<button>` with labels.

**Documented limitations** (user-rejected this round):

- No explicit close (X) button in the corner.
- No Android hardware-back hook — on Android Chrome PWA, back exits app instead of closing sheet.

## Testing

### Unit

| Target | Cases |
|--------|-------|
| `classifyAttachmentPreview` extension | audio / video / code kinds return correct preview kind |
| `useViewportFetch` | IntersectionObserver mock fires → state idle→loading→ready; unmount aborts; error path |
| `actions.shareViaWebShare` | navigator.share present → share called; absent → clipboard fallback; AbortError → silent |
| `actions.downloadFile` | `<a>` created with download attr, clicked, removed |
| `InlinePreviewCard` per kind | `renderToStaticMarkup` → correct icon, snippet, `data-testid` |
| Each `*Body` | `renderToStaticMarkup` with mocked source → core DOM asserted |
| `FilePreviewSheet` | `origin=offer_download` → Download rendered; other origins → Share only; `key={source.id}` remount on source change |
| `ImageGenerationMessage` | existing 6 cases pass; new: tap image → sheet opens with ImageBody |
| `OfferDownloadMessage` | preview-able mime → card opens sheet; non-preview → direct download (regression) |

### Integration

- `<UserMessage>` mixed attachments → tap image → sheet opens with ImageBody.
- `<LocalFileLinkCard>` `.ts` file → sheet opens with CodeBody; Shiki module mocked → asserts highlighted output.
- `<OfferDownloadMessage>` → Download button click triggers `<a download>` spy.

### Render-loop regression

Per project CLAUDE.md: new selectors / hooks returning collections must be stable-ref. `useViewportFetch` returns `useMemo`-keyed object. Add `renderForLoopCheck` mount for `FilePreviewSheet` with all 9 bodies.

### Manual QA matrix

1. iPhone Safari 16+ — each of 9 kinds × 4 origins.
2. Android Chrome — same matrix.
3. Desktop Chrome — sheet centers, ESC closes, backdrop closes.
4. Slow 3G throttle — skeleton states show, no jank.
5. Offline — error states show, no crash.
6. 100+ message thread mixed kinds — scroll perf smooth.

### Shiki test isolation

Mock the `shiki` module in unit tests:

```ts
mock.module("shiki", () => ({
  codeToHtml: async () => "<pre>mocked</pre>",
}))
```

Production fallback path tested by forcing `import()` rejection and asserting plain `<pre>`.

### Snapshot stability

Per `kanna-react-style`: no `Date.now()` in DOM, fixed `Date(0)` fixtures, deterministic snapshots.

### Lint

- All new files pass `bun run lint --max-warnings=0`.
- No `any` / no unnarrowed `unknown`.
- Ratchet: if warnings drop, lower cap in same PR.

### Test commands

```bash
bun test src/client/components/messages/file-preview/
bun test src/client/components/messages/
bun run lint -- src/client/components/messages/file-preview
```

## Migration Plan

The implementation plan (produced by `writing-plans` after this spec is approved) should sequence work as:

1. Add `file-preview/` directory with `PreviewSource` type, `useViewportFetch`, `actions`, empty `FilePreviewSheet` shell.
2. Port image / pdf / markdown / table / text / json bodies — feature parity with current modal.
3. Add audio / video bodies.
4. Add code body with Shiki dynamic import + fallback.
5. Add `InlinePreviewCard` factory.
6. Migrate `UserMessage` and `LocalFileLinkCard` to the sheet; keep modal alive in parallel for one commit, then delete.
7. Migrate `OfferDownloadMessage` — first call site whose card behaviour changes (preview tap + Download action).
8. Migrate `ImageGenerationMessage` — drop bespoke markup.
9. Delete `AttachmentPreviewModal.tsx` after all four migrations green.
10. Lint ratchet + final manual QA pass.

Each step gets its own commit with passing tests for its scope.

## Open Questions

None at spec time. A11y close affordance and Download visibility flags were resolved during brainstorming (swipe-only dismiss; Download retained for `offer_download` only).
