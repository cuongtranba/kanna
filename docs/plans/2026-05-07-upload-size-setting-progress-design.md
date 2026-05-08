# Upload Size Setting + Upload Progress UI — Design

Date: 2026-05-07

## Problem

Max upload size is hardcoded (`MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024` at `src/server/server.ts:43`). Users running self-hosted Kanna cannot raise or lower the limit without editing source. Uploads also show no progress — for large files (close to 100 MB) the UI sits in an indeterminate "uploading" state with no feedback and no way to cancel.

## Goals

1. Make per-file max upload size a user setting (server-enforced, client-mirrored).
2. Show determinate upload progress per attachment.
3. Allow cancelling an in-flight upload.

## Non-goals (YAGNI)

- Per-batch file count setting (`MAX_UPLOAD_FILES = 50` stays hardcoded).
- MIME allowlist, retention policy, retry button.
- Multi-file aggregate progress bar.

## Design

### 1. Settings model

Add to `src/shared/types.ts`:

```ts
export interface UploadSettings {
  maxFileSizeMb: number  // default 100
}
export const UPLOAD_DEFAULTS: UploadSettings = { maxFileSizeMb: 100 }
export const UPLOAD_MAX_FILE_SIZE_MB_MIN = 1
export const UPLOAD_MAX_FILE_SIZE_MB_MAX = 2048
```

Extend `AppSettingsSnapshot` and `AppSettingsPatch` with `uploads: UploadSettings`.

`src/server/app-settings.ts`:
- `normalizeUploadSettings(value, warnings)` — clamp to [min,max], emit warnings on invalid input.
- Wire into `normalizeAppSettings`, `toFilePayload`, `toSnapshot`, `applyPatch`, `AppSettingsFile`.
- New method `setUploads(patch: Partial<UploadSettings>)`.

### 2. Server enforcement

`src/server/server.ts` upload handler — read live limit from settings manager:

```ts
const { maxFileSizeMb } = appSettings.getSnapshot().uploads
const maxBytes = maxFileSizeMb * 1024 * 1024
if (file.size > maxBytes) {
  return Response.json(
    { error: `File "${file.name}" exceeds the ${maxFileSizeMb} MB limit.` },
    { status: 400 },
  )
}
```

`MAX_UPLOAD_FILES = 50` stays hardcoded.

### 3. Settings UI

`src/client/app/SettingsPage.tsx` — new "Uploads" section with one number field:
- Label "Max file size" with "MB" suffix.
- Range 1–2048, default 100, helper text states default and range.
- Commit on blur or Enter (mirror Terminal scrollback pattern).
- Invalid input: red ring + inline error, do not commit.
- Tabular numerics for the value.

Calls existing settings PATCH endpoint with `{ uploads: { maxFileSizeMb: n } }`. Live snapshot push propagates to all clients.

### 4. Upload helper (XHR)

New file `src/client/lib/uploadFile.ts`:

```ts
export interface UploadHandle {
  promise: Promise<{ attachments: ChatAttachment[] }>
  abort: () => void
}
export function uploadFile(args: {
  projectId: string
  file: File
  onProgress: (loaded: number, total: number) => void
}): UploadHandle
```

Uses `XMLHttpRequest` for `upload.onprogress`. `abort()` calls `xhr.abort()`. Rejects with:
- `UploadAbortedError` on abort (silent in UI).
- `Error(payload.error || "Upload failed")` on non-2xx.

Throttle progress: only commit state when `%` changes by ≥1 OR every 100 ms. Always commit `loaded === total` synchronously.

### 5. ChatInput wiring

`src/client/components/chat-ui/ChatInput.tsx`:
- Replace `fetch` block (~line 554) with `uploadFile(...)`.
- Extend client-side attachment state with `progress?: { loaded, total }` and `abort?: () => void` (not sent to server).
- `onProgress` updates the attachment by `tempId`.
- Store `handle.abort` on attachment.
- User-remove of an uploading attachment: `abort()` first, then drop. `removedAttachmentIdsRef` path still cleans up late completions.
- `UploadAbortedError`: silently drop, no error toast.

### 6. Card UI — determinate ring overlay

New `src/client/components/messages/AttachmentUploadOverlay.tsx`:
- Absolute overlay covering the card, `bg-background/60 backdrop-blur-sm`.
- Centered SVG ring (track + progress circle, `stroke-dasharray` driven by progress, rotated -90°).
- Smooth `transition: stroke-dashoffset 120ms ease-out` between throttled updates.
- Center text: percent (tabular nums). On group hover: swap to `lucide-react` `X` button calling `onCancel`. Project `Tooltip` "Cancel upload".
- `role="progressbar"`, `aria-valuenow`, `aria-label`.
- Indeterminate fallback before first progress event: spinning 25% arc.
- `prefers-reduced-motion: reduce`: drop transition + spin.

Mount in `AttachmentImageCard` and `AttachmentFileCard` when `status === "uploading"`. `failed` keeps existing visual.

`/impeccable:impeccable` polish pass on overlay + Settings section after wiring works.

## Tests

- `src/server/app-settings.test.ts` — defaults, clamp out-of-range, warning text, patch round-trip.
- `src/server/uploads.test.ts` — dynamic limit: oversized → 400, within → 200, change setting → next request enforces new value.
- `src/client/lib/uploadFile.test.ts` — mocked `XMLHttpRequest`: progress callback, abort rejects, error JSON parsed.
- `src/client/app/SettingsPage.test.tsx` — new field renders, commit fires patch, out-of-range rejected.
- `AttachmentUploadOverlay` snapshot/unit tests at 0%, 50%, 100%, hover-cancel state.

## Rollout (TDD, small commits)

1. Types + server normalize + tests.
2. Server enforcement swap + tests.
3. SettingsPage Uploads section + tests.
4. `uploadFile.ts` helper + tests.
5. `AttachmentUploadOverlay` + tests.
6. ChatInput integration (progress + abort).
7. Manual browser pass: 3-file upload, ring animation, hover-cancel, oversized rejection on live setting change.
8. `/impeccable:impeccable` polish pass.

## Risks

- XHR vs `fetch` `FormData` parity — Bun handles both.
- Throttling could skip the final 100% frame — guard by always committing `loaded === total` synchronously.
- Late `onprogress` after `abort` — guarded by checking handle state in callback.

## Files touched

- `src/shared/types.ts`
- `src/server/app-settings.ts` + `.test.ts`
- `src/server/server.ts`
- `src/server/uploads.test.ts`
- `src/client/app/SettingsPage.tsx` + `.test.tsx`
- `src/client/lib/uploadFile.ts` + `.test.ts`
- `src/client/components/chat-ui/ChatInput.tsx`
- `src/client/components/messages/AttachmentUploadOverlay.tsx` + tests
- `src/client/components/messages/AttachmentCard.tsx`
