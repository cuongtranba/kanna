---
id: adr-20260704-preview-file-in-chat
c3-seal: afdafb2f501e0b8f153d3847b93cfc9cfa93b1c6cfbfeedd0f1cf4f5956b90fd
title: preview-file-in-chat
type: adr
goal: |-
    Add a new `mcp__kanna__preview_file` MCP tool to the kanna-mcp host so the agent
    can surface a tap-to-open file **preview** card in the chat transcript. Tapping
    the card opens the existing `FilePreviewSheet` and renders the file in a
    human-friendly way (markdown typeset, mermaid drawn as a diagram, code
    Shiki-highlighted, CSV as a table, images/pdf/audio/video inline). This is a
    read-only preview surface — distinct from `offer_download`, which produces a
    download anchor and shows no rich rendering. The decision being authorized is:
    (1) a new OUT tool contract on c3-226, and (2) that its content URL resolves via
    the absolute-path local-file route so it works inside worktree chats.
status: implemented
date: "2026-07-04"
---

# Add mcp__kanna__preview_file in-chat file preview tool

## Goal

Add a new `mcp__kanna__preview_file` MCP tool to the kanna-mcp host so the agent
can surface a tap-to-open file **preview** card in the chat transcript. Tapping
the card opens the existing `FilePreviewSheet` and renders the file in a
human-friendly way (markdown typeset, mermaid drawn as a diagram, code
Shiki-highlighted, CSV as a table, images/pdf/audio/video inline). This is a
read-only preview surface — distinct from `offer_download`, which produces a
download anchor and shows no rich rendering. The decision being authorized is:
(1) a new OUT tool contract on c3-226, and (2) that its content URL resolves via
the absolute-path local-file route so it works inside worktree chats.

## Context

Kanna users are mobile-first and rarely open an IDE. Today, when the agent writes
a spec/plan or the user asks to read a file, the only options are pasting raw
content, summarizing (lossy), or `offer_download` (download, not read). None let
the user *read* the file in-place with friendly formatting. The kanna-mcp host
(c3-226) already publishes `mcp__kanna__*` tools and normalizes them through
`src/shared/tools.ts` (c3-303) via `ref-tool-hydration`; `offer_download` is the
proven precedent for a read-only file tool that renders a transcript card. The
affected topology is c3-226 (tool surface owner), c3-303 (tool normalization),
and their shared parent c3-2 (server). A subtlety: worktree chats run with a cwd
that differs from `project.localPath`, so the project-scoped content URL 404s for
files written in a worktree.

## Decision

Register `preview_file` in `buildKannaMcpTools` (`src/server/kanna-mcp.ts`). A pure
`resolveWorkspaceFile` performs the same path-safety checks as
`resolveOfferDownload`, infers the MIME via `inferAttachmentContentType`, and
gates on `isPreviewableMime` (accepts `text/*`, `image/*`, `audio/*`, `video/*`,
`application/json`, `application/pdf`; rejects everything else with guidance to
use `offer_download`). The content URL is built with `buildLocalFileContentUrl`
(the `/api/local-file?path=<abs>` route), NOT the project-scoped URL, so worktree
files resolve. The tool result hydrates through `src/shared/tools.ts` into a
`HydratedPreviewFileToolCall` and renders as `PreviewFileMessage`, which opens
`FilePreviewSheet` with `origin: "preview_file"` (Share only, no Download). This
wins over reusing `offer_download` because preview and download are different user
intents with different affordances, and over the project-scoped URL because only
the absolute-path route is worktree-correct.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-226 | component | Owns src/server/kanna-mcp.ts; gains a new OUT preview_file tool on the mcp__kanna__* surface plus the resolveWorkspaceFile/isPreviewableMime gate | Add a Contract row; confirm ref-tool-hydration + ref-strong-typing + rule-colocated-bun-test compliance. Parent c3-2 Delta: no-delta — the server's coordinator/MCP-host responsibility is unchanged; a new tool on the already-published surface fits the current goal slice, so no container edit is required |
| c3-303 | component | Owns src/shared/tools.ts; gains PREVIEW_FILE_TOOL_NAME normalization + preview_file hydration | Confirm ref-tool-hydration governs the new envelope and ref-colocated-bun-test is satisfied by the colocated tools.test.ts |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-tool-hydration | The preview_file tool call must normalize through src/shared/tools.ts before the UI renders it, like every other MCP tool | comply — added normalizeToolCall + hydrateToolResult cases + tools.test.ts |
| ref-strong-typing | The new tool arg/result crosses the MCP + client↔server boundary and must be a named type | comply — added PreviewFileToolCall / PreviewFileToolResult / HydratedPreviewFileToolCall in src/shared/types.ts |
| ref-local-first-data | The preview content URL must stay on the localhost-bound local-file route; no new external surface | comply — buildLocalFileContentUrl targets the existing /api/local-file localhost route |
| ref-colocated-bun-test | Both components this ADR changes (c3-226, c3-303) are governed by colocated tests; the new server logic and the shared normalization each need a test beside their source | comply — kanna-mcp.test.ts, uploads.test.ts, and tools.test.ts sit next to the files they cover |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | No any/unknown at the new tool envelope or the preview payload | comply — resolveWorkspaceFile returns a typed discriminated result; PreviewFileToolResult is fully typed |
| rule-colocated-bun-test | The new server logic and client card each need a colocated *.test.ts(x) | comply — kanna-mcp.test.ts (resolveWorkspaceFile), uploads.test.ts (MIME), tools.test.ts, PreviewFileMessage.test.tsx + .loop.test.tsx |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Server tool | resolveWorkspaceFile + isPreviewableMime gate + preview_file registration returning {kind:"file_preview", ...} | src/server/kanna-mcp.ts |
| MIME inference | inferAttachmentContentType extended with image/pdf/audio/video/mermaid extensions | src/server/uploads.ts |
| Shared types | PreviewFileToolCall / PreviewFileToolResult / HydratedPreviewFileToolCall + union members | src/shared/types.ts |
| Normalization | PREVIEW_FILE_TOOL_NAME + normalizeToolCall + hydrateToolResult cases | src/shared/tools.ts |
| System prompt | preview_file proactivity nudge in KANNA_SYSTEM_PROMPT_BASE | src/shared/kanna-system-prompt.ts |
| Client card | PreviewFileMessage (tap-to-open, no download anchor), FilePreviewSheet origin=preview_file, MermaidBody, KannaTranscript SPECIAL_TOOL_NAMES + render case | src/client/components/messages/PreviewFileMessage.tsx, src/client/app/KannaTranscript.tsx |
| C3 doc | Add preview_file Contract row to c3-226 | c3 read c3-226 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template/test surface is changed by this decision | This ADR adds one component Contract row to c3-226 and product code only; no c3x command, validator, schema, hint, or template is touched | Enforced by existing bun test + c3 check (structural pass, no new validator needed) |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun test src/server/kanna-mcp.test.ts | Asserts resolveWorkspaceFile path-safety, previewability gate, and the .json-charset regression | src/server/kanna-mcp.test.ts |
| bun test src/server/uploads.test.ts | Asserts MIME inference for image/pdf/audio/video/mermaid and octet-stream fallback | src/server/uploads.test.ts |
| bun test src/shared/tools.test.ts | Asserts normalize + hydrate for preview_file | src/shared/tools.test.ts |
| bun test src/client/app/KannaTranscript.test.tsx | Asserts preview_file is a SPECIAL tool (card not collapsed into a group) | src/client/app/KannaTranscript.test.tsx |
| bun run lint | Side-effect seal: no node/Bun IO import in src/shared or src/client | eslint.config.js |
| c3 check | c3-226 Contract row stays consistent with the published tool surface | .c3 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Reuse offer_download for previews | offer_download renders a download anchor and no rich formatting; the user requirement is to READ the file in-place (mermaid drawn, code highlighted). Download ≠ preview — different intent, different affordance |
| Build the content URL with buildProjectFileContentUrl (project-scoped) | It resolves from project.localPath, which differs from the chat cwd in worktree chats, so a file written in a worktree 404s. buildLocalFileContentUrl (/api/local-file?path=<abs>) is worktree-correct |
| Document preview_file only under the generic "mcp__kanna__* tool surface" row (as offer_download is) | preview_file introduces a real architectural decision — the worktree-safe URL choice and the previewability gate — that deserves an explicit, greppable Contract row |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Previewability gate wrongly rejects a valid kind because the inferred MIME carries a charset param (e.g. application/json; charset=utf-8) | isPreviewableMime normalizes the MIME essence (split on ';', trim, lowercase) before matching | bun test src/server/kanna-mcp.test.ts (".json despite its charset mime parameter") |
| Card renders invisibly (collapsed into "N tool calls") if PREVIEW_FILE_TOOL_NAME is missing from SPECIAL_TOOL_NAMES | Regression test asserts a preview_file between bash calls is not collapsed | bun test src/client/app/KannaTranscript.test.tsx |
| Preview shows raw text instead of a drawn diagram / rich render | pickBody routes mermaid→MermaidBody, markdown→MarkdownBody, code→CodeBody, table→TableBody, image→ImageBody before the text fallback | bun test src/client/components/messages/file-preview/FilePreviewSheet.test.tsx |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/kanna-mcp.test.ts src/server/uploads.test.ts | 42 + 64 pass, 0 fail |
| bun test src/shared/tools.test.ts | pass (preview_file normalize + hydrate) |
| bun test src/client src/shared | 963 pass, 0 fail |
| bun run lint | clean (0 errors, 0 warnings) |
| c3 check | no issues |
