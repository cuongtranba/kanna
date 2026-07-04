# In-chat file preview tool (`preview_file`) — Design

**Status:** Approved (design)
**Date:** 2026-07-04
**Author:** brainstorming session (hieplam)
**Scope:** Give the model a first-class way to show a file to the user inside the Kanna chat, rendered for human reading on a phone.

## Problem

Kanna users work from phones and rarely open an IDE. When the agent
produces a file the user must read — a spec, a plan, a report, a code
file — there is no good path today:

- The model **summarizes** the file into its reply (lossy, unformatted,
  and the user explicitly wanted the file, not a summary).
- The model **mentions the path**, which renders as a small link chip
  (`LocalFileLinkCard`) the user may not notice.
- The model calls **`offer_download`**, whose semantic is *delivering
  bytes* — a download chip, not a reading experience.

The earlier auto-surface-artifacts design (2026-06-03) deliberately
excludes `.md`/source files — exactly the spec/plan files this feature
is about — so nothing covers "the agent wants the user to READ this".

## The differentiator — human-friendly rendering

**This tool exists to render files for human reading. It must never
show raw text for a kind Kanna can render richly.** This is the key
difference from `offer_download`; without it a new tool is pointless.

Rendering contract (kind → what the user sees):

| File kind | Rendered as |
|-----------|-------------|
| `.md` / markdown | Typeset document: headings, lists, GFM tables, links; ```` ```mermaid ```` fences → **drawn Mermaid diagram** (`MermaidDiagram`, zoomable); other code fences → **Shiki-highlighted code** with copy button |
| `.mmd` / `.mermaid` | **Drawn Mermaid diagram** (not raw diagram source) |
| Code files (`.ts`, `.go`, `.py`, …) | Shiki syntax-highlighted source (github-dark), plain `<pre>` fallback only on Shiki failure or >200 KB |
| `.json` | Prettified, indented |
| `.csv` / `.tsv` | Real table with sticky header |
| Images / PDF / audio / video | Native visual/media body |
| Anything else previewable as text | Monospace text (last resort, not the norm) |

Most of this contract is already implemented: `FilePreviewSheet`
(mobile-first, `100dvh`, swipe-down dismiss — iOS-safe per the
2026-05-16 mobile-file-preview design) picks per-kind bodies, and
`MarkdownBody` renders through the chat's `defaultMarkdownComponents`,
which already routes `language-mermaid` fences to `MermaidDiagram` and
other fences to `HighlightedCode` (`src/client/components/messages/shared.tsx`).

Gaps this feature must close and prove:

1. **Standalone `.mmd` / `.mermaid` files render as diagrams.** Today the
   extension is unknown → served as `application/octet-stream`, bucketed
   raw. Add extension → `text/vnd.mermaid` mapping in
   `inferAttachmentContentType` (`src/server/uploads.ts`), a `mermaid`
   preview kind in the client classifier, and a `MermaidBody` (thin
   wrapper: text fetch → `MermaidDiagram`).
2. **Prove the contract inside the sheet.** Tests + browser QA evidence
   that a `.md` file containing mermaid + code fences shows a drawn
   diagram and highlighted code inside `FilePreviewSheet` (not just in
   chat messages).

## Decisions (confirmed with user)

1. **New MCP tool** `mcp__kanna__preview_file` — not an `offer_download`
   mode flag (muddy semantics for the model), not a client-side
   path-mention heuristic (cannot distinguish "mentioning" from "read
   this"; hijacks the screen on casual mentions).
2. **Card only, tap to open.** The tool drops a normal file card in the
   transcript; the user taps to open the full-screen reader. No
   auto-open at any moment. ("The card is like normal click file and
   view.")
3. **Live fetch.** The card/sheet fetch current bytes from disk at
   view time. File gone later → "File no longer available" card state
   (same as `offer_download` today). No content snapshot in the event
   log, zero token cost for file bytes.
4. **Read-oriented, not bytes-oriented.** Sheet footer shows **Share
   only** for this origin; `offer_download` keeps its Download button.
5. **Name: `preview_file`.** Matches the tool's semantic ("this is a
   preview tool"); `show_file` was the working name during
   brainstorming.

## Architecture

Rides the proven `offer_download` pipeline end-to-end. Both drivers
(SDK + PTY) inherit the tool through the existing kanna-mcp loopback
server; tool_use/tool_result persist and replay through the normal
transcript flow. No new event kinds, no driver changes.

### 1. Server — tool registration (`src/server/kanna-mcp.ts`)

- Tool `preview_file`, args `{ path: string, label?: string }`
  (workspace-relative path; optional human title for the card).
- Resolution reuses the `resolveOfferDownload` logic — extract the
  shared part as `resolveWorkspaceFile(args, input)`: trim → posix
  normalize → reject absolute/`../` traversal → resolve inside chat
  cwd (`args.localPath`) → stat must be a file → infer mime.
- **`contentUrl` uses the absolute-path route:**
  `buildLocalFileContentUrl(absolutePath)` → `/api/local-file?path=<abs>`
  (the route `LocalFileLinkCard` / image generation already use).
  NOT the project-scoped route: `/api/projects/:id/files/...` serves
  from `project.localPath` (`server.ts`), while the chat cwd may be a
  worktree — a spec written in a worktree chat would 404 or serve the
  wrong tree's bytes. `offer_download` has that mismatch today
  (pre-existing, untouched); `preview_file` must not inherit it because
  worktree chats are this feature's primary use case.
- **Previewability gate:** reject with `isError` when the inferred mime
  is not renderable (`application/octet-stream`, archives). Error text
  tells the model what to do instead: "not a previewable kind — use
  offer_download". Renderable families: `text/*`, `application/json`,
  `application/pdf`, `image/*`, `audio/*`, `video/*`.
- Result content (small JSON, ~200 bytes — file bytes are never in the
  tool result): `{ kind: "file_preview", contentUrl, relativePath,
  fileName, displayName, size, mimeType }`.
- **Tool description** (the LLM-proactivity lever, mirrors the
  `expose_port` pattern):

  > Show a file from the workspace to the user as a rich in-chat
  > preview card in the Kanna UI. Tapping the card opens a full-screen
  > mobile-friendly reader: markdown is typeset (mermaid/flowchart
  > blocks render as diagrams, code blocks are syntax-highlighted),
  > source files are syntax-highlighted, CSV becomes a table, images
  > display inline. This is how the user READS a file on their phone
  > without an IDE.
  >
  > Call this proactively whenever the user should read a file:
  > - right after you create or substantially edit a spec, plan,
  >   report, or document you want the user to review
  > - when the user asks to see, read, show, or open a file
  > - when your reply refers to a file the user should read to follow
  >   along
  >
  > Do NOT paste the file's content into your reply as well — call this
  > tool and give a 1–2 sentence summary instead. Use offer_download
  > only when the user needs the bytes (archives, binaries, exports).

### 2. Shared — types + hydration (`src/shared/types.ts`, `src/shared/tools.ts`)

- `PREVIEW_FILE_TOOL_NAME = mcp__kanna__preview_file`.
- `PreviewFileToolCall` (`toolKind: "preview_file"`, input
  `{ path, label? }`), `PreviewFileToolResult` (same field shape as
  `OfferDownloadToolResult`; distinct named type per `rule-strong-typing`),
  `HydratedPreviewFileToolCall`, added to the `HydratedToolCall` union.
- `normalizeToolCall` + result-hydration cases keyed on the tool name,
  mirroring the `offer_download` cases.

### 3. Client — card + sheet (`src/client/components/messages/`)

- **`PreviewFileMessage.tsx`** — sibling of `OfferDownloadMessage`:
  HEAD-probe the `contentUrl`; ready → `AttachmentFileCard` (icon, name,
  type · size meta, "tap to view" affordance) that opens
  `FilePreviewSheet` on tap; missing → disabled "File no longer
  available" card. No `<a download>` branch — this card never downloads.
- **`PreviewOrigin`** union gains `"preview_file"`
  (`file-preview/types.ts`). Footer logic already keys Download off
  `origin === "offer_download"`, so the new origin shows Share only.
- **Mermaid gap:** `classifyAttachmentIcon` / `classifyAttachmentPreview`
  (`attachmentPreview.ts`) learn a `mermaid` kind for `.mmd`/`.mermaid`
  (and mime `text/vnd.mermaid`); `FilePreviewSheet.pickBody` routes it to
  a new `bodies/MermaidBody.tsx` (text fetch via `useTextBodyContent` →
  `MermaidDiagram`).
- **`KannaTranscript.tsx`** render switch: `toolKind === "preview_file"`
  → `<PreviewFileMessage>` (next to the `offer_download` case; same
  hidden/collapse-group treatment). Nested subagent transcripts
  (`SubagentMessage.tsx`) mirror wherever they special-case
  `offer_download` today.

### 4. System prompt nudge (`src/shared/kanna-system-prompt.ts`)

One sentence appended to `KANNA_SYSTEM_PROMPT_BASE`:

> When the user should read a file (a spec or plan you wrote, a file
> they asked to see), call `mcp__kanna__preview_file` to show it in the
> chat instead of pasting or summarizing its content.

Both drivers inherit it (single source of truth). Keeps the tool
description as the detailed contract; the base line exists because the
user's core requirement is proactive showing, and tool descriptions
alone are weaker at shifting default behavior.

## Data flow

```
model calls mcp__kanna__preview_file({path})
  └─ kanna-mcp resolveWorkspaceFile
       ├─ invalid/missing/binary ──> isError text back to model (it can correct)
       └─ ok ──> {kind:"file_preview", contentUrl, ...} tool result (~200 B)
             └─ persisted tool_use/tool_result → hydrateToolCall
                  └─ HydratedPreviewFileToolCall
                       └─ KannaTranscript → PreviewFileMessage
                            ├─ HEAD probe contentUrl (ready/missing)
                            ├─ file card in transcript
                            └─ tap → FilePreviewSheet (origin "preview_file")
                                 └─ pickBody: markdown→MarkdownBody (mermaid
                                    drawn, code highlighted) · code→CodeBody
                                    · mermaid→MermaidBody · csv→TableBody · …
```

## Error handling

| Failure | Behavior |
|---------|----------|
| Empty/absolute/traversal path | `isError`: "Invalid project file path" (model self-corrects) |
| File not found / not a file | `isError` with the path so the model can fix it |
| Non-previewable kind (archive, unknown binary) | `isError`: "not a previewable kind — use offer_download" |
| File deleted after show, before tap | HEAD probe fails → disabled "File no longer available" card |
| File deleted while sheet open | Body fetch error block (existing sheet behavior) |
| File > 1 MB | Existing body truncation notice ("Preview truncated to 1024 KB") |
| Mermaid source invalid | `MermaidDiagram` existing fallback (raw source block) |
| Shiki load failure / > 200 KB | Existing plain `<pre>` fallback |

## Testing

Unit (colocated, `bun test`):

- `resolveWorkspaceFile` — path-safety table (traversal, absolute,
  missing, directory, ok) + previewability gate (md/ts/json/csv/png ok;
  zip/unknown-binary rejected with actionable message). Existing
  `resolveOfferDownload` tests keep passing against the shared helper.
- `tools.ts` — normalize + hydrate `preview_file` (mirrors
  `offer_download` cases).
- `PreviewFileMessage` — ready card renders name/meta; tap opens sheet
  (origin `preview_file`); missing state disables card; no download
  anchor present.
- `FilePreviewSheet` — origin `preview_file` shows Share, hides
  Download; `.mmd` source routes to `MermaidBody`.
- `attachmentPreview` — `.mmd`/`.mermaid` classify as mermaid kind.
- Render-loop check (`renderForLoopCheck`) for the new message
  component per the repo rule.

Browser QA (agent-browser, iPhone viewport 390×844) — PR evidence:

1. Ask the agent to write a spec `.md` (with a mermaid block + code
   fence) and preview it → card appears → tap → typeset markdown,
   **drawn diagram**, highlighted code. Screenshot.
2. Preview a `.ts` file → highlighted source. Screenshot.
3. Preview a missing path → model receives error; no broken card.
4. Delete file after card shown → "File no longer available".
5. Desktop viewport sanity: sheet centers (`md:` breakpoint).

## Out of scope

- Directory listing / file browser (explicitly unwanted — mobile UX).
- Auto-opening the sheet (rejected during brainstorming).
- Content snapshots in the event log / share-export durability.
- Fixing `offer_download`'s project-scoped URL for worktree chats
  (pre-existing behavior; `preview_file` avoids it by using the
  absolute-path route).
- SDK/PTY driver changes (tool rides the existing kanna-mcp pipeline).
- Non-mermaid diagram languages (plantuml, graphviz).

## C3 / docs

- ADR before implementation (`/c3 change`): new tool on c3-226
  (kanna-mcp-host), tools-union delta on c3-303, new client component
  under c3-1; `.mmd` mime mapping note on the uploads/file-serving
  component.
- CLAUDE.md: add `preview_file` to the Kanna-MCP tool list section.
- `c3x check` after landing; update component docs in the same PR.
