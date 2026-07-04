# preview_file In-Chat File Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mcp__kanna__preview_file` — an MCP tool the agent calls to show a file in the Kanna chat as a tap-to-open card that renders markdown (with drawn mermaid diagrams and Shiki-highlighted code), syntax-highlighted source, CSV tables, images, and more — so mobile users never need to leave Kanna to read a file.

**Architecture:** Rides the proven `offer_download` pipeline end-to-end: the server tool returns a small JSON result (~200 bytes, no file bytes), which is persisted, hydrated via `HydratedPreviewFileToolCall`, and rendered by a new `PreviewFileMessage` card that opens `FilePreviewSheet` with `origin: "preview_file"`. The tool uses `/api/local-file?path=<abs>` (not the project-scoped URL) so it works correctly in worktree chats where `localPath ≠ project.localPath`.

**Tech Stack:** Bun/TypeScript, React 19, Radix UI Dialog, Shiki (syntax highlight), Mermaid (diagram render), Zod (MCP schema validation), `bun test` (test runner).

## Global Constraints

- All new files under `src/shared/` and `src/client/` must NOT import Node/Bun IO (`node:fs`, `Bun.file`, etc.) — side-effect lint seals these layers at error.
- `bun run lint` must pass with `--max-warnings=0` after every task.
- `bun test` must pass after every task.
- Tool name constant: `PREVIEW_FILE_TOOL_NAME = "mcp__kanna__preview_file"` — used in normalization/hydration and SPECIAL_TOOL_NAMES.
- Tool result JSON shape: `{ kind: "file_preview", contentUrl, relativePath, fileName, displayName, size, mimeType }`.
- `contentUrl` uses `buildLocalFileContentUrl(absolutePath)` → `/api/local-file?path=<abs>` (never `buildProjectFileContentUrl`).
- Previewability gate accepts: `text/*`, `image/*`, `audio/*`, `video/*`, `application/json`, `application/pdf`. Rejects everything else (octet-stream, archives) with actionable error "not a previewable kind — use offer_download".
- `preview_file` origin in the sheet shows Share only — no Download button (Download is `offer_download`-only).
- `mcp__kanna__preview_file` must be in `SPECIAL_TOOL_NAMES` in `KannaTranscript.tsx` — otherwise the card collapses into the "N tool calls" group and becomes invisible.
- All new components must pass `renderForLoopCheck` (no unstable selector refs).
- Worktree path: `/Users/home/repos/kanna/.worktrees/preview-file-in-chat`. Run all commands from there.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/server/uploads.ts` | Modify | Add image/pdf/audio/video/mermaid MIME entries to `inferAttachmentContentType` |
| `src/server/kanna-mcp.ts` | Modify | Extract `resolveWorkspaceFile`, add `preview_file` tool with previewability gate |
| `src/server/kanna-mcp.test.ts` | Modify | Tests for `resolveWorkspaceFile` path-safety + gate; `preview_file` tool registration |
| `src/shared/types.ts` | Modify | Add `PreviewFileToolCall`, `PreviewFileToolResult`, `HydratedPreviewFileToolCall`, update unions |
| `src/shared/tools.ts` | Modify | Add `PREVIEW_FILE_TOOL_NAME`, normalizeToolCall case, hydrateToolResult case |
| `src/shared/tools.test.ts` | Modify | Add normalize + hydrate `preview_file` unit tests |
| `src/shared/kanna-system-prompt.ts` | Modify | Append one-sentence preview nudge to `KANNA_SYSTEM_PROMPT_BASE` |
| `src/shared/kanna-system-prompt.test.ts` | Modify | Update any assertions that compare the exact base string |
| `src/client/components/messages/file-preview/types.ts` | Modify | Add `"preview_file"` to `PreviewOrigin` union |
| `src/client/components/messages/attachmentPreview.ts` | Modify | Add `"mermaid"` to `AttachmentIconKind`; classify `.mmd`/`.mermaid`/`text/vnd.mermaid`; add `"Diagram"` label |
| `src/client/components/messages/attachmentPreview.test.ts` | Modify | Add mermaid classification tests |
| `src/client/components/messages/file-preview/bodies/MermaidBody.tsx` | Create | Text-fetch `PreviewSource` → `MermaidDiagram` |
| `src/client/components/messages/file-preview/FilePreviewSheet.tsx` | Modify | Import `MermaidBody`; add `mermaid` branch in `pickBody`; add `"Diagram"` label to `FRIENDLY_MIME_BY_KIND` |
| `src/client/components/messages/file-preview/FilePreviewSheet.test.tsx` | Modify | `origin=preview_file` shows Share, hides Download; `.mmd` routes to MermaidBody |
| `src/client/components/messages/PreviewFileMessage.tsx` | Create | Tap-to-view card (HEAD probe → ready/missing states, no `<a download>`) |
| `src/client/components/messages/PreviewFileMessage.test.tsx` | Create | Static render tests: ready card, missing card, no download anchor |
| `src/client/components/messages/PreviewFileMessage.loop.test.tsx` | Create | `renderForLoopCheck` safety check |
| `src/client/app/KannaTranscript.tsx` | Modify | Import `PreviewFileMessage` + `PREVIEW_FILE_TOOL_NAME`; add to `SPECIAL_TOOL_NAMES`; add render case |
| `src/client/app/KannaTranscript.test.tsx` | Modify | Regression: `preview_file` between two bash calls is NOT collapsed |

---

## Task 1: Extend MIME table in uploads.ts

**Files:**
- Modify: `src/server/uploads.ts`
- Modify: `src/server/server.test.ts` (uploads describe block already exists; add inline)

**Interfaces:**
- Produces: `inferAttachmentContentType(".png")` → `"image/png"`, `".mmd"` → `"text/vnd.mermaid"`, etc.

- [ ] **Step 1: Write failing tests for the new MIME entries**

Add to the `describe("uploads", ...)` block in `src/server/server.test.ts`:

```ts
test("inferAttachmentContentType returns correct MIME for image extensions", () => {
  expect(inferAttachmentContentType("photo.png")).toBe("image/png")
  expect(inferAttachmentContentType("photo.jpg")).toBe("image/jpeg")
  expect(inferAttachmentContentType("photo.jpeg")).toBe("image/jpeg")
  expect(inferAttachmentContentType("photo.gif")).toBe("image/gif")
  expect(inferAttachmentContentType("photo.webp")).toBe("image/webp")
  expect(inferAttachmentContentType("icon.svg")).toBe("image/svg+xml")
  expect(inferAttachmentContentType("photo.avif")).toBe("image/avif")
})

test("inferAttachmentContentType returns correct MIME for pdf", () => {
  expect(inferAttachmentContentType("doc.pdf")).toBe("application/pdf")
})

test("inferAttachmentContentType returns correct MIME for audio extensions", () => {
  expect(inferAttachmentContentType("song.mp3")).toBe("audio/mpeg")
  expect(inferAttachmentContentType("song.wav")).toBe("audio/wav")
  expect(inferAttachmentContentType("song.m4a")).toBe("audio/mp4")
  expect(inferAttachmentContentType("song.ogg")).toBe("audio/ogg")
})

test("inferAttachmentContentType returns correct MIME for video extensions", () => {
  expect(inferAttachmentContentType("clip.mp4")).toBe("video/mp4")
  expect(inferAttachmentContentType("clip.mov")).toBe("video/quicktime")
  expect(inferAttachmentContentType("clip.webm")).toBe("video/webm")
  expect(inferAttachmentContentType("clip.m4v")).toBe("video/mp4")
})

test("inferAttachmentContentType returns text/vnd.mermaid for .mmd and .mermaid", () => {
  expect(inferAttachmentContentType("diagram.mmd")).toBe("text/vnd.mermaid")
  expect(inferAttachmentContentType("diagram.mermaid")).toBe("text/vnd.mermaid")
})

test("inferAttachmentContentType still returns octet-stream for unknown binary extensions", () => {
  expect(inferAttachmentContentType("archive.zip")).toBe("application/octet-stream")
  expect(inferAttachmentContentType("noext")).toBe("application/octet-stream")
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/home/repos/kanna/.worktrees/preview-file-in-chat
bun test src/server/server.test.ts 2>&1 | grep -E "pass|fail|error" | tail -10
```

Expected: several failures like "Expected: image/png, Received: application/octet-stream"

- [ ] **Step 3: Extend `TEXT_CONTENT_TYPE_BY_EXTENSION` in `src/server/uploads.ts`**

Replace the existing `TEXT_CONTENT_TYPE_BY_EXTENSION` map with:

```ts
const TEXT_CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  [".avif", "image/avif"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".jsonc", TEXT_PLAIN_CONTENT_TYPE],
  [".m4a", "audio/mp4"],
  [".m4v", "video/mp4"],
  [".md", "text/markdown; charset=utf-8"],
  [".mermaid", "text/vnd.mermaid"],
  [".mmd", "text/vnd.mermaid"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".ogg", "audio/ogg"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".tsv", "text/tab-separated-values; charset=utf-8"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
])
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/server/server.test.ts 2>&1 | grep -E "pass|fail|error" | tail -10
```

Expected: all pass.

- [ ] **Step 5: Run lint**

```bash
bun run lint 2>&1 | tail -5
```

Expected: no errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/server/uploads.ts src/server/server.test.ts
git commit -m "feat(uploads): extend MIME map with image/pdf/audio/video/mermaid types"
```

---

## Task 2: Extract `resolveWorkspaceFile` + add `preview_file` tool in kanna-mcp.ts

**Files:**
- Modify: `src/server/kanna-mcp.ts`
- Modify: `src/server/kanna-mcp.test.ts`

**Interfaces:**
- Produces: `resolveWorkspaceFile(args, input)` → `{ ok: true, payload: ResolvedWorkspaceFile } | { ok: false, error: string }`
- Produces: `preview_file` MCP tool registered in `buildKannaMcpTools`
- `ResolvedWorkspaceFile` has shape: `{ contentUrl, relativePath, fileName, displayName, size, mimeType }`

- [ ] **Step 1: Write failing tests for `resolveWorkspaceFile`**

Add to `src/server/kanna-mcp.test.ts` (after existing `resolveOfferDownload` tests):

```ts
import { resolveWorkspaceFile } from "./kanna-mcp"
// (also add to existing import line at top)

describe("resolveWorkspaceFile", () => {
  test("resolves a markdown file and returns local-file contentUrl", async () => {
    const mdPath = path.join(tempRoot, "spec.md")
    await writeFile(mdPath, "# hello")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "spec.md" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl).toMatch(/^\/api\/local-file\?path=/)
    expect(result.payload.contentUrl).toContain(encodeURIComponent(mdPath))
    expect(result.payload.fileName).toBe("spec.md")
    expect(result.payload.mimeType).toContain("text/markdown")
    expect(result.payload.size).toBeGreaterThan(0)
  })

  test("resolves a .ts source file", async () => {
    const tsPath = path.join(tempRoot, "index.ts")
    await writeFile(tsPath, "export const x = 1")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "index.ts" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toContain("text/plain")
  })

  test("resolves a .mmd file", async () => {
    const mmdPath = path.join(tempRoot, "flow.mmd")
    await writeFile(mmdPath, "graph TD\nA-->B")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "flow.mmd" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toBe("text/vnd.mermaid")
  })

  test("resolves a .png image file", async () => {
    const pngPath = path.join(tempRoot, "logo.png")
    await writeFile(pngPath, Buffer.from("PNG"))
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "logo.png" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.mimeType).toBe("image/png")
  })

  test("rejects absolute paths", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "/etc/passwd" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("Invalid project file path")
  })

  test("rejects traversal paths", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "../../../etc/passwd" })
    expect(result.ok).toBe(false)
  })

  test("rejects missing files", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "ghost.md" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("ghost.md")
  })

  test("rejects directories", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "dist" })
    expect(result.ok).toBe(false)
  })

  test("rejects non-previewable mime (zip)", async () => {
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "dist/build.zip" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("offer_download")
  })

  test("rejects extensionless files as non-previewable", async () => {
    const noExt = path.join(tempRoot, "Makefile")
    await writeFile(noExt, "all:\n\techo done")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "Makefile" })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected error")
    expect(result.error).toContain("offer_download")
  })

  test("uses label as displayName when provided", async () => {
    const mdPath = path.join(tempRoot, "notes.md")
    await writeFile(mdPath, "# notes")
    const result = await resolveWorkspaceFile({ localPath: tempRoot }, { path: "notes.md", label: "My Notes" })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.displayName).toBe("My Notes")
  })

  test("resolveOfferDownload still works (regression: shared helper)", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "dist/build.zip" },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl).toContain("/api/projects/p1/files/")
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test src/server/kanna-mcp.test.ts 2>&1 | grep -E "resolveWorkspaceFile|pass|fail" | tail -20
```

Expected: failures like "resolveWorkspaceFile is not a function"

- [ ] **Step 3: Add `resolveWorkspaceFile` and `preview_file` tool to `src/server/kanna-mcp.ts`**

First, add the import for `buildLocalFileContentUrl` at the top (alongside `buildProjectFileContentUrl`):

```ts
import { buildProjectFileContentUrl, buildLocalFileContentUrl } from "../shared/projectFileUrl"
```

Add after `resolveOfferDownload`:

```ts
export interface ResolvedWorkspaceFile {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType: string
}

const PREVIEWABLE_MIME_PREFIXES = ["text/", "image/", "audio/", "video/"]
const PREVIEWABLE_EXACT_MIMES = new Set(["application/json", "application/pdf"])

function isPreviewableMime(mimeType: string): boolean {
  if (PREVIEWABLE_EXACT_MIMES.has(mimeType)) return true
  return PREVIEWABLE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))
}

export async function resolveWorkspaceFile(
  args: { localPath: string },
  input: { path: string; label?: string },
): Promise<{ ok: true; payload: ResolvedWorkspaceFile } | { ok: false; error: string }> {
  const rawPath = (input.path ?? "").trim()
  if (!rawPath) {
    return { ok: false, error: "path is required" }
  }

  const relativePath = path.posix.normalize(rawPath.replaceAll("\\", "/"))
  if (
    !relativePath
    || relativePath === "."
    || relativePath.startsWith("../")
    || relativePath.includes("/../")
    || path.posix.isAbsolute(relativePath)
  ) {
    return { ok: false, error: `Invalid project file path: ${input.path}` }
  }

  const projectRoot = path.resolve(args.localPath)
  const absolutePath = path.resolve(args.localPath, relativePath)
  if (absolutePath !== projectRoot && !absolutePath.startsWith(`${projectRoot}${path.sep}`)) {
    return { ok: false, error: "Path resolves outside the project root" }
  }

  const info = await statPathOrNull(absolutePath)
  if (!info) {
    return { ok: false, error: `File not found: ${relativePath}` }
  }
  if (!info.isFile()) {
    return { ok: false, error: `Not a file: ${relativePath}` }
  }

  const fileName = path.posix.basename(relativePath)
  const mimeType = inferAttachmentContentType(fileName)

  if (!isPreviewableMime(mimeType)) {
    return {
      ok: false,
      error: `"${relativePath}" is not a previewable kind (${mimeType}) — use offer_download to let the user download it instead.`,
    }
  }

  const contentUrl = buildLocalFileContentUrl(absolutePath)

  return {
    ok: true,
    payload: {
      contentUrl,
      relativePath,
      fileName,
      displayName: input.label?.trim() || fileName,
      size: info.size,
      mimeType,
    },
  }
}
```

Also update the imports at the top of `kanna-mcp.ts` — replace `inferProjectFileContentType` import with `inferAttachmentContentType`:

```ts
import { inferAttachmentContentType } from "./uploads"
```

Then add the `preview_file` tool description constant and register the tool inside `buildKannaMcpTools`:

Add constant before `OFFER_DOWNLOAD_DESCRIPTION`:

```ts
const PREVIEW_FILE_DESCRIPTION = `Show a file from the workspace to the user as a rich in-chat preview card in the Kanna UI. Tapping the card opens a full-screen mobile-friendly reader: markdown is typeset (mermaid/flowchart blocks render as diagrams, code blocks are syntax-highlighted), source files are syntax-highlighted, CSV becomes a table, images display inline. This is how the user READS a file on their phone without an IDE.

Call this proactively whenever the user should read a file:
- right after you create or substantially edit a spec, plan, report, or document you want the user to review
- when the user asks to see, read, show, or open a file
- when your reply refers to a file the user should read to follow along

Do NOT paste the file's content into your reply as well — call this tool and give a 1–2 sentence summary instead. Use offer_download only when the user needs the bytes (archives, binaries, exports).

Args:
- path: workspace-relative path to the file (must stay inside the project root)
- label: optional human-readable title shown on the card
`
```

Add the `preview_file` tool inside `buildKannaMcpTools`, right after the `offer_download` tool registration:

```ts
tool(
  "preview_file",
  PREVIEW_FILE_DESCRIPTION,
  {
    path: z.string().describe("Workspace-relative path to the file to preview"),
    label: z.string().optional().describe("Optional human-readable title shown on the card"),
  },
  async (input) => {
    const result = await resolveWorkspaceFile(args, input)
    if (!result.ok) {
      return {
        content: [{ type: "text" as const, text: result.error }],
        isError: true,
      }
    }
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ kind: "file_preview", ...result.payload }),
      }],
    }
  },
),
```

Also update the `resolveOfferDownload` function to call `inferAttachmentContentType` instead of `inferProjectFileContentType` (since we changed the import):

In `resolveOfferDownload`, replace:
```ts
const mimeType = inferProjectFileContentType(fileName)
```
with:
```ts
const mimeType = inferAttachmentContentType(fileName)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/server/kanna-mcp.test.ts 2>&1 | grep -E "pass|fail|error" | tail -20
```

Expected: all pass.

- [ ] **Step 5: Run full test suite + lint**

```bash
bun test && bun run lint 2>&1 | tail -10
```

Expected: all pass, 0 lint warnings.

- [ ] **Step 6: Commit**

```bash
git add src/server/kanna-mcp.ts src/server/kanna-mcp.test.ts
git commit -m "feat(kanna-mcp): add preview_file tool with resolveWorkspaceFile and previewability gate"
```

---

## Task 3: Shared types + tools normalization/hydration

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/shared/tools.ts`
- Modify: `src/shared/tools.test.ts`

**Interfaces:**
- Produces: `PreviewFileToolCall` (toolKind `"preview_file"`, input `{ path: string; label?: string }`)
- Produces: `PreviewFileToolResult` (`{ contentUrl, relativePath, fileName, displayName, size, mimeType }`)
- Produces: `HydratedPreviewFileToolCall` — added to `HydratedToolCall` union
- Produces: `PREVIEW_FILE_TOOL_NAME = "mcp__kanna__preview_file"` exported from `tools.ts`

- [ ] **Step 1: Write failing tests for normalization and hydration**

Add to `src/shared/tools.test.ts`:

```ts
// In the normalizeToolCall describe block:
test("maps mcp__kanna__preview_file to preview_file toolKind", () => {
  const tool = normalizeToolCall({
    toolName: "mcp__kanna__preview_file",
    toolId: "tool-pf-1",
    input: { path: "docs/spec.md", label: "The spec" },
  })
  expect(tool.toolKind).toBe("preview_file")
  if (tool.toolKind !== "preview_file") throw new Error("unexpected kind")
  expect(tool.input.path).toBe("docs/spec.md")
  expect(tool.input.label).toBe("The spec")
})

test("maps mcp__kanna__preview_file without label", () => {
  const tool = normalizeToolCall({
    toolName: "mcp__kanna__preview_file",
    toolId: "tool-pf-2",
    input: { path: "src/index.ts" },
  })
  expect(tool.toolKind).toBe("preview_file")
  if (tool.toolKind !== "preview_file") throw new Error("unexpected kind")
  expect(tool.input.label).toBeUndefined()
})

// In the hydrateToolResult describe block (or add a new one):
test("hydrates preview_file tool result", () => {
  const normalized = normalizeToolCall({
    toolName: "mcp__kanna__preview_file",
    toolId: "tool-pf-3",
    input: { path: "docs/spec.md" },
  })
  const rawResult = {
    content: [{
      type: "text",
      text: JSON.stringify({
        kind: "file_preview",
        contentUrl: "/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md",
        relativePath: "docs/spec.md",
        fileName: "spec.md",
        displayName: "spec.md",
        size: 1024,
        mimeType: "text/markdown; charset=utf-8",
      }),
    }],
  }
  const result = hydrateToolResult(normalized, rawResult)
  expect(result).toMatchObject({
    contentUrl: "/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md",
    relativePath: "docs/spec.md",
    fileName: "spec.md",
    displayName: "spec.md",
    size: 1024,
    mimeType: "text/markdown; charset=utf-8",
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test src/shared/tools.test.ts 2>&1 | grep -E "preview_file|pass|fail" | tail -10
```

Expected: failures like "Expected: preview_file, Received: mcp_generic"

- [ ] **Step 3: Add types to `src/shared/types.ts`**

Find the `OfferDownloadToolCall` interface (around line 960). After `OfferDownloadToolResult`, add:

```ts
export interface PreviewFileToolCall
  extends ToolCallBase<"preview_file", { path: string; label?: string }> { }

export interface PreviewFileToolResult {
  contentUrl: string
  relativePath: string
  fileName: string
  displayName: string
  size: number
  mimeType: string
}
```

Add `PreviewFileToolCall` to the `NormalizedToolCall` union (after `OfferDownloadToolCall`):

```ts
  | PreviewFileToolCall
```

Find `HydratedOfferDownloadToolCall` (around line 1457) and add after it:

```ts
export type HydratedPreviewFileToolCall =
  HydratedToolCallBase<"preview_file", PreviewFileToolCall["input"], PreviewFileToolResult>
```

Add `HydratedPreviewFileToolCall` to the `HydratedToolCall` union (after `HydratedOfferDownloadToolCall`):

```ts
  | HydratedPreviewFileToolCall
```

- [ ] **Step 4: Add normalization and hydration to `src/shared/tools.ts`**

At the top, add to imports from `types.ts`:
```ts
  PreviewFileToolResult,
```

After `OFFER_DOWNLOAD_TOOL_NAME`, add:
```ts
export const PREVIEW_FILE_TOOL_NAME = `mcp__${KANNA_MCP_SERVER_NAME}__preview_file`
```

In `normalizeToolCall`, right after the `if (toolName === OFFER_DOWNLOAD_TOOL_NAME)` block, add:

```ts
  if (toolName === PREVIEW_FILE_TOOL_NAME) {
    return {
      kind: "tool",
      toolKind: "preview_file",
      toolName,
      toolId,
      input: {
        path: typeof input.path === "string" ? input.path : "",
        label: typeof input.label === "string" ? input.label : undefined,
      },
      rawInput: input,
    }
  }
```

In `hydrateToolResult` switch, add a `case "preview_file":` block right after `case "offer_download":`:

```ts
    case "preview_file": {
      const text = extractMcpTextContent(parsed)
      const payload = text ? parseJsonValue(text) : parsed
      const record = asRecord(payload)
      return {
        contentUrl: typeof record?.contentUrl === "string" ? record.contentUrl : "",
        relativePath: typeof record?.relativePath === "string" ? record.relativePath : "",
        fileName: typeof record?.fileName === "string" ? record.fileName : "",
        displayName: typeof record?.displayName === "string"
          ? record.displayName
          : typeof record?.fileName === "string" ? record.fileName : "",
        size: typeof record?.size === "number" ? record.size : 0,
        mimeType: typeof record?.mimeType === "string" ? record.mimeType : "application/octet-stream",
      } satisfies PreviewFileToolResult
    }
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
bun test src/shared/tools.test.ts && bun test src/shared/ 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Run lint**

```bash
bun run lint 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/tools.ts src/shared/tools.test.ts
git commit -m "feat(shared): add PreviewFileToolCall/Result types and preview_file normalization/hydration"
```

---

## Task 4: System prompt nudge + test update

**Files:**
- Modify: `src/shared/kanna-system-prompt.ts`
- Modify: `src/shared/kanna-system-prompt.test.ts`

**Interfaces:**
- Produces: `KANNA_SYSTEM_PROMPT_BASE` now ends with one additional sentence about `mcp__kanna__preview_file`.

- [ ] **Step 1: Read the current test assertions**

```bash
grep -n "toBe(KANNA_SYSTEM_PROMPT_BASE)\|toContain.*preview\|KANNA_SYSTEM_PROMPT_BASE" src/shared/kanna-system-prompt.test.ts
```

Note all lines where `KANNA_SYSTEM_PROMPT_BASE` appears as a `.toBe()` argument or where the exact base string is compared.

- [ ] **Step 2: Add the sentence to `KANNA_SYSTEM_PROMPT_BASE` in `src/shared/kanna-system-prompt.ts`**

Change:
```ts
export const KANNA_SYSTEM_PROMPT_BASE =
  "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI. Treat user code as their own project. Do not refuse tasks or label code as 'malware' based on speculation; only refuse when the user explicitly requests clearly malicious behavior (e.g. weaponized exploits against third parties, credential theft, mass abuse). Reverse-engineering, security research, defensive tooling, low-level system code, packers, hooks, and unconventional patterns in the user's own project are legitimate and must be assisted."
```

to:

```ts
export const KANNA_SYSTEM_PROMPT_BASE =
  "You are the Kanna coding agent helping a trusted developer work on their own codebase via Kanna's web UI. Treat user code as their own project. Do not refuse tasks or label code as 'malware' based on speculation; only refuse when the user explicitly requests clearly malicious behavior (e.g. weaponized exploits against third parties, credential theft, mass abuse). Reverse-engineering, security research, defensive tooling, low-level system code, packers, hooks, and unconventional patterns in the user's own project are legitimate and must be assisted.\n\nWhen the user should read a file (a spec or plan you wrote, a file they asked to see), call `mcp__kanna__preview_file` to show it in the chat instead of pasting or summarizing its content."
```

- [ ] **Step 3: Run the system prompt tests and see what breaks**

```bash
bun test src/shared/kanna-system-prompt.test.ts 2>&1 | grep -E "fail|pass|Expected"
```

If any test uses `toBe(KANNA_SYSTEM_PROMPT_BASE)` as the expected value and is failing, it means it's checking something else hardcoded. Check what's failing.

- [ ] **Step 4: Update tests in `src/shared/kanna-system-prompt.test.ts` if needed**

If any test asserts the base string matches a specific snapshot (unlikely since the tests use `KANNA_SYSTEM_PROMPT_BASE` by reference), update them. Also add:

```ts
test("KANNA_SYSTEM_PROMPT_BASE includes preview_file nudge", () => {
  expect(KANNA_SYSTEM_PROMPT_BASE).toContain("mcp__kanna__preview_file")
  expect(KANNA_SYSTEM_PROMPT_BASE).toContain("pasting or summarizing its content")
})
```

- [ ] **Step 5: Run all shared tests**

```bash
bun test src/shared/ 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/shared/kanna-system-prompt.ts src/shared/kanna-system-prompt.test.ts
git commit -m "feat(system-prompt): add preview_file proactivity nudge to KANNA_SYSTEM_PROMPT_BASE"
```

---

## Task 5: Client — PreviewOrigin, mermaid support, MermaidBody, FilePreviewSheet

**Files:**
- Modify: `src/client/components/messages/file-preview/types.ts`
- Modify: `src/client/components/messages/attachmentPreview.ts`
- Modify: `src/client/components/messages/attachmentPreview.test.ts`
- Create: `src/client/components/messages/file-preview/bodies/MermaidBody.tsx`
- Modify: `src/client/components/messages/file-preview/FilePreviewSheet.tsx`
- Modify: `src/client/components/messages/file-preview/FilePreviewSheet.test.tsx`

**Interfaces:**
- Produces: `PreviewOrigin` includes `"preview_file"`
- Produces: `classifyAttachmentIcon` returns `"mermaid"` for `.mmd`/`.mermaid`/`text/vnd.mermaid`
- Produces: `MermaidBody` component — `({ source: PreviewSource }) => JSX`
- Produces: `pickBody` in `FilePreviewSheet` routes `iconKind === "mermaid"` → `MermaidBody`

- [ ] **Step 1: Add `"preview_file"` to `PreviewOrigin` in `src/client/components/messages/file-preview/types.ts`**

Change:
```ts
export type PreviewOrigin =
  | "user_attachment"
  | "local_file_link"
  | "offer_download"
  | "image_generation"
```

to:
```ts
export type PreviewOrigin =
  | "user_attachment"
  | "local_file_link"
  | "offer_download"
  | "image_generation"
  | "preview_file"
```

- [ ] **Step 2: Write failing attachmentPreview tests for mermaid**

Add to `src/client/components/messages/attachmentPreview.test.ts`:

```ts
import { classifyAttachmentIcon, classifyAttachmentPreview } from "./attachmentPreview"
import type { ChatAttachment } from "../../../shared/types"

function makeAttachment(overrides: Partial<ChatAttachment>): ChatAttachment {
  return {
    id: "a1", kind: "file", displayName: "file.txt", absolutePath: "", relativePath: "",
    contentUrl: "/url", mimeType: "text/plain", size: 100, ...overrides,
  }
}

describe("mermaid classification", () => {
  test("classifyAttachmentIcon returns mermaid for .mmd extension", () => {
    const a = makeAttachment({ displayName: "flow.mmd", mimeType: "text/vnd.mermaid" })
    expect(classifyAttachmentIcon(a)).toBe("mermaid")
  })

  test("classifyAttachmentIcon returns mermaid for .mermaid extension", () => {
    const a = makeAttachment({ displayName: "arch.mermaid", mimeType: "text/vnd.mermaid" })
    expect(classifyAttachmentIcon(a)).toBe("mermaid")
  })

  test("classifyAttachmentIcon returns mermaid for text/vnd.mermaid mime even with unknown extension", () => {
    const a = makeAttachment({ displayName: "diagram", mimeType: "text/vnd.mermaid" })
    expect(classifyAttachmentIcon(a)).toBe("mermaid")
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
bun test src/client/components/messages/attachmentPreview.test.ts 2>&1 | grep -E "mermaid|fail" | tail -5
```

- [ ] **Step 4: Update `attachmentPreview.ts` to add mermaid kind**

In `AttachmentIconKind`, add `"mermaid"` to the union:

```ts
export type AttachmentIconKind =
  | "image"
  | "pdf"
  | "markdown"
  | "json"
  | "table"
  | "code"
  | "text"
  | "archive"
  | "audio"
  | "video"
  | "file"
  | "mermaid"
```

In `FRIENDLY_MIME_BY_KIND`, add:
```ts
  mermaid: "Diagram",
```

In `classifyAttachmentIcon`, add before the `CODE_OR_CONFIG_EXTENSIONS` check:

```ts
  if (mimeType === "text/vnd.mermaid" || extension === ".mmd" || extension === ".mermaid") return "mermaid"
```

- [ ] **Step 5: Run attachmentPreview tests**

```bash
bun test src/client/components/messages/attachmentPreview.test.ts 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 6: Create `src/client/components/messages/file-preview/bodies/MermaidBody.tsx`**

```tsx
import { MermaidDiagram } from "../../MermaidDiagram"
import { useTextBodyContent } from "./textLoader"
import type { PreviewSource } from "../types"

export function MermaidBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  if (state.status === "loading") {
    return <div className="p-4 text-sm text-muted-foreground"><div className="hidden" /> Loading…</div>
  }
  if (state.status === "error") {
    return <div className="p-4 text-sm text-destructive">{state.message}</div>
  }
  return (
    <div className="p-4">
      <MermaidDiagram source={state.content} />
    </div>
  )
}
```

- [ ] **Step 7: Update `FilePreviewSheet.tsx` — import MermaidBody + add pickBody branch**

Add import at the top (alongside other body imports):
```ts
import { MermaidBody } from "./bodies/MermaidBody"
```

In `pickBody`, add the `mermaid` branch before the `code` check:
```ts
  if (iconKind === "mermaid") return MermaidBody
```

The full `pickBody` function should now look like:
```ts
function pickBody(source: PreviewSource): React.ComponentType<{ source: PreviewSource }> {
  const attachmentLike: ChatAttachment = {
    id: source.id,
    kind: "file",
    displayName: source.displayName,
    mimeType: source.mimeType,
    size: source.size ?? 0,
    contentUrl: source.contentUrl,
    relativePath: source.relativePath ?? "",
    absolutePath: "",
  }
  const iconKind = classifyAttachmentIcon(attachmentLike)
  if (iconKind === "image") return ImageBody
  if (iconKind === "pdf") return PdfBody
  if (iconKind === "audio") return AudioBody
  if (iconKind === "video") return VideoBody
  if (iconKind === "table") return TableBody
  if (iconKind === "markdown") return MarkdownBody
  if (iconKind === "json") return JsonBody
  if (iconKind === "mermaid") return MermaidBody
  if (iconKind === "code") return CodeBody
  const target = classifyAttachmentPreview(attachmentLike)
  if (target.kind === "external") return PdfBody
  return TextBody
}
```

- [ ] **Step 8: Add FilePreviewSheet tests for preview_file origin and mermaid routing**

Add to `src/client/components/messages/file-preview/FilePreviewSheet.test.tsx`:

```ts
test("when origin=preview_file, Download button NOT rendered", () => {
  const html = renderSheetBody({ ...SRC, origin: "preview_file" })
  expect(html).not.toContain(">Download<")
  expect(html).toContain("Share")
})

test("pickBody routes mermaid mime to MermaidBody (renders without throwing)", () => {
  const mermaidSrc: PreviewSource = {
    id: "m1", contentUrl: "/u/flow.mmd", displayName: "flow.mmd", fileName: "flow.mmd",
    mimeType: "text/vnd.mermaid", size: 50, origin: "preview_file",
  }
  expect(() => renderSheetBody(mermaidSrc)).not.toThrow()
})
```

- [ ] **Step 9: Run FilePreviewSheet tests**

```bash
bun test src/client/components/messages/file-preview/FilePreviewSheet.test.tsx 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 10: Run full test suite + lint**

```bash
bun test && bun run lint 2>&1 | tail -10
```

- [ ] **Step 11: Commit**

```bash
git add \
  src/client/components/messages/file-preview/types.ts \
  src/client/components/messages/attachmentPreview.ts \
  src/client/components/messages/attachmentPreview.test.ts \
  src/client/components/messages/file-preview/bodies/MermaidBody.tsx \
  src/client/components/messages/file-preview/FilePreviewSheet.tsx \
  src/client/components/messages/file-preview/FilePreviewSheet.test.tsx
git commit -m "feat(client): add mermaid kind, MermaidBody, preview_file origin, and FilePreviewSheet routing"
```

---

## Task 6: PreviewFileMessage card component

**Files:**
- Create: `src/client/components/messages/PreviewFileMessage.tsx`
- Create: `src/client/components/messages/PreviewFileMessage.test.tsx`
- Create: `src/client/components/messages/PreviewFileMessage.loop.test.tsx`

**Interfaces:**
- Consumes: `HydratedPreviewFileToolCall` from `src/shared/types.ts`
- Produces: `PreviewFileMessage` component — renders tap-to-view card (no `<a download>`)

- [ ] **Step 1: Write failing tests**

Create `src/client/components/messages/PreviewFileMessage.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedPreviewFileToolCall } from "../../../shared/types"
import { PreviewFileMessage } from "./PreviewFileMessage"

function buildMessage(overrides: Partial<HydratedPreviewFileToolCall> = {}): HydratedPreviewFileToolCall {
  return {
    id: "msg-pf-1",
    timestamp: new Date(0).toISOString(),
    kind: "tool",
    toolKind: "preview_file",
    toolName: "mcp__kanna__preview_file",
    toolId: "tool-pf-1",
    input: { path: "docs/spec.md", label: "Design Spec" },
    rawResult: undefined,
    isError: false,
    result: {
      contentUrl: "/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md",
      relativePath: "docs/spec.md",
      fileName: "spec.md",
      displayName: "Design Spec",
      size: 4096,
      mimeType: "text/markdown; charset=utf-8",
    },
    ...overrides,
  }
}

describe("PreviewFileMessage", () => {
  test("renders card with file name and friendly type", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage()} />)
    expect(html).toContain("Design Spec")
    expect(html).toContain("Markdown")
  })

  test("renders size in tabular-nums", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage()} />)
    expect(html).toContain("tabular-nums")
    expect(html).toContain("4 KB")
  })

  test("does NOT include a download anchor", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage()} />)
    expect(html).not.toContain("download=")
  })

  test("renders nothing when result is missing", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage({ result: undefined })} />)
    expect(html).toBe("")
  })

  test("renders missing card state when state=missing (static: just checks it doesn't throw with no result)", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage({ result: undefined })} />)
    expect(html).toBe("")
  })

  test("falls back to fileName when displayName empty", () => {
    const msg = buildMessage({
      result: {
        contentUrl: "/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md",
        relativePath: "docs/spec.md",
        fileName: "spec.md",
        displayName: "",
        size: 0,
        mimeType: "text/markdown; charset=utf-8",
      },
    })
    const html = renderToStaticMarkup(<PreviewFileMessage message={msg} />)
    expect(html).toContain("spec.md")
  })

  test("renders data-testid=preview-file-card", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage()} />)
    expect(html).toContain('data-testid="preview-file-card"')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test src/client/components/messages/PreviewFileMessage.test.tsx 2>&1 | tail -5
```

Expected: failure "Cannot find module './PreviewFileMessage'"

- [ ] **Step 3: Create `src/client/components/messages/PreviewFileMessage.tsx`**

```tsx
import { useEffect, useState } from "react"
import type { ChatAttachment, HydratedPreviewFileToolCall } from "../../../shared/types"
import { AttachmentFileCard, formatAttachmentSize } from "./AttachmentCard"
import { classifyAttachmentIcon, friendlyMimeLabel } from "./attachmentPreview"
import { FilePreviewSheet } from "./file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "./file-preview/types"

interface Props {
  message: HydratedPreviewFileToolCall
}

type ProbeState = "idle" | "ready" | "missing"

export function PreviewFileMessage({ message }: Props) {
  const result = message.result
  const contentUrl = result?.contentUrl
  const [state, setState] = useState<ProbeState>("idle")
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (!contentUrl) return
    const controller = new AbortController()
    fetch(contentUrl, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        setState(response.ok ? "ready" : "missing")
      })
      .catch(() => {})
    return () => controller.abort()
  }, [contentUrl])

  if (!result || !contentUrl) return null

  const attachment: ChatAttachment = {
    id: `preview-file-${message.toolId}`,
    kind: "file",
    displayName: result.displayName || result.fileName,
    absolutePath: result.relativePath,
    relativePath: result.relativePath,
    contentUrl,
    mimeType: result.mimeType,
    size: result.size,
  }

  const iconKind = classifyAttachmentIcon(attachment)
  const friendlyType = friendlyMimeLabel(iconKind, result.mimeType)
  const sizeLabel = result.size > 0 ? formatAttachmentSize(result.size) : null
  const meta = (
    <>
      {friendlyType}
      {sizeLabel ? <> · <span className="tabular-nums">{sizeLabel}</span></> : null}
    </>
  )

  if (state === "missing") {
    return (
      <div className="flex" data-testid="preview-file-card">
        <AttachmentFileCard attachment={attachment} disabledReason="File no longer available" />
      </div>
    )
  }

  const ariaLabel = `Preview ${attachment.displayName}, ${friendlyType}${sizeLabel ? `, ${sizeLabel}` : ""}`
  return (
    <>
      <div className="flex" data-testid="preview-file-card">
        <AttachmentFileCard
          attachment={attachment}
          onClick={() => setPreviewOpen(true)}
          meta={meta}
          ariaLabel={ariaLabel}
        />
      </div>
      <FilePreviewSheet
        source={previewOpen ? toPreviewSourceFromAttachment(attachment, "preview_file") : null}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  )
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test src/client/components/messages/PreviewFileMessage.test.tsx 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Create `src/client/components/messages/PreviewFileMessage.loop.test.tsx`**

```tsx
import "../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import type { HydratedPreviewFileToolCall } from "../../../shared/types"
import { PreviewFileMessage } from "./PreviewFileMessage"

const MSG: HydratedPreviewFileToolCall = {
  id: "msg-loop-1",
  timestamp: new Date(0).toISOString(),
  kind: "tool",
  toolKind: "preview_file",
  toolName: "mcp__kanna__preview_file",
  toolId: "tool-loop-1",
  input: { path: "spec.md" },
  rawResult: undefined,
  isError: false,
  result: {
    contentUrl: "/api/local-file?path=%2Ftmp%2Fspec.md",
    relativePath: "spec.md",
    fileName: "spec.md",
    displayName: "spec.md",
    size: 512,
    mimeType: "text/markdown; charset=utf-8",
  },
}

describe("PreviewFileMessage loop safety", () => {
  test("does not trigger Maximum update depth warnings on mount", async () => {
    const result = await renderForLoopCheck(<PreviewFileMessage message={MSG} />)
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
```

- [ ] **Step 6: Run loop test**

```bash
bun test src/client/components/messages/PreviewFileMessage.loop.test.tsx 2>&1 | tail -5
```

Expected: pass.

- [ ] **Step 7: Run full test suite + lint**

```bash
bun test && bun run lint 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add \
  src/client/components/messages/PreviewFileMessage.tsx \
  src/client/components/messages/PreviewFileMessage.test.tsx \
  src/client/components/messages/PreviewFileMessage.loop.test.tsx
git commit -m "feat(client): add PreviewFileMessage card component with loop-safety check"
```

---

## Task 7: Wire KannaTranscript — render case + SPECIAL_TOOL_NAMES

**Files:**
- Modify: `src/client/app/KannaTranscript.tsx`
- Modify: `src/client/app/KannaTranscript.test.tsx`

**Interfaces:**
- Consumes: `PreviewFileMessage` from `../components/messages/PreviewFileMessage`
- Consumes: `PREVIEW_FILE_TOOL_NAME` from `../../shared/tools`
- Produces: `toolKind === "preview_file"` renders `<PreviewFileMessage>` (not collapsed)

- [ ] **Step 1: Write a failing regression test in `KannaTranscript.test.tsx`**

Add to the `describe("KannaTranscript", ...)` block:

```ts
import type { HydratedPreviewFileToolCall } from "../../shared/types"

function createPreviewFileMessage(id: string): HydratedPreviewFileToolCall {
  return {
    id,
    kind: "tool",
    toolKind: "preview_file",
    toolName: "mcp__kanna__preview_file",
    toolId: id,
    input: { path: "spec.md" },
    timestamp: new Date().toISOString(),
    rawResult: undefined,
    isError: false,
    result: {
      contentUrl: "/api/local-file?path=%2Ftmp%2Fspec.md",
      relativePath: "spec.md",
      fileName: "spec.md",
      displayName: "spec.md",
      size: 512,
      mimeType: "text/markdown; charset=utf-8",
    },
  }
}

test("preview_file message sandwiched between bash calls is NOT collapsed into a tool group", () => {
  const messages = [
    createToolMessage("bash-1"),
    createPreviewFileMessage("preview-1"),
    createToolMessage("bash-2"),
  ]
  const html = renderTranscript(messages as HydratedTranscriptMessage[])
  // preview-file-card must appear in the output, not be absorbed into a CollapsedToolGroup
  expect(html).toContain('data-testid="preview-file-card"')
  // Verify it did NOT get absorbed (CollapsedToolGroup doesn't render preview-file-card)
  expect(html).not.toContain("tool calls")
})

test("preview_file with no result is not rendered (guard in render switch)", () => {
  const noResult: HydratedPreviewFileToolCall = {
    id: "pf-no-result",
    kind: "tool",
    toolKind: "preview_file",
    toolName: "mcp__kanna__preview_file",
    toolId: "pf-no-result",
    input: { path: "spec.md" },
    timestamp: new Date().toISOString(),
    rawResult: undefined,
    isError: false,
    result: undefined,
  }
  const html = renderTranscript([noResult as HydratedTranscriptMessage])
  expect(html).not.toContain('data-testid="preview-file-card"')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test src/client/app/KannaTranscript.test.tsx 2>&1 | grep -E "preview_file|collapsed|fail" | tail -10
```

Expected: failures (preview-file-card not found / tool group text appears)

- [ ] **Step 3: Add imports to `src/client/app/KannaTranscript.tsx`**

After the `OfferDownloadMessage` import line:
```ts
import { PreviewFileMessage } from "../components/messages/PreviewFileMessage"
```

Add `PREVIEW_FILE_TOOL_NAME` to the imports from `../../shared/tools` (find where `DELEGATE_SUBAGENT_TOOL_NAME` is imported and check if there's a shared/tools import; if not, add):
```ts
import { PREVIEW_FILE_TOOL_NAME } from "../../shared/tools"
```

- [ ] **Step 4: Add `PREVIEW_FILE_TOOL_NAME` to `SPECIAL_TOOL_NAMES`**

Change line 40:
```ts
const SPECIAL_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite", DELEGATE_SUBAGENT_TOOL_NAME])
```
to:
```ts
const SPECIAL_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode", "TodoWrite", DELEGATE_SUBAGENT_TOOL_NAME, PREVIEW_FILE_TOOL_NAME])
```

- [ ] **Step 5: Add the render case in the transcript render switch**

Find (around line 508):
```ts
        if (message.toolKind === "offer_download" && message.result) {
          rendered = <OfferDownloadMessage key={message.id} message={message} />
          break
        }
```

Add after it:
```ts
        if (message.toolKind === "preview_file" && message.result) {
          rendered = <PreviewFileMessage key={message.id} message={message} />
          break
        }
```

- [ ] **Step 6: Run all KannaTranscript tests**

```bash
bun test src/client/app/KannaTranscript.test.tsx 2>&1 | tail -10
```

Expected: all pass including the two new regression tests.

- [ ] **Step 7: Run full test suite + lint**

```bash
bun test && bun run lint 2>&1 | tail -10
```

Expected: all pass, 0 warnings.

- [ ] **Step 8: Commit**

```bash
git add src/client/app/KannaTranscript.tsx src/client/app/KannaTranscript.test.tsx
git commit -m "feat(transcript): wire preview_file render case and add to SPECIAL_TOOL_NAMES"
```

---

## Task 8: Full test suite pass + adversarial review + C3 update

**Files:**
- Modify: `CLAUDE.md` — add `preview_file` to Kanna-MCP tool list if the section exists

- [ ] **Step 1: Run full test suite**

```bash
bun test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 2: Run lint**

```bash
bun run lint 2>&1 | tail -10
```

Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run adversarial reviewer**

Use the `adversarial-reviewer` agent in the main session. It will:
- Verify spec coverage
- Check SPECIAL_TOOL_NAMES regression
- Check previewability gate
- Check `buildLocalFileContentUrl` usage (not project-scoped)
- Verify Download button absent for `preview_file` origin
- Verify mermaid routing in `pickBody`

Wait for PASS/FAIL result.

- [ ] **Step 4: Run C3 sweep**

```bash
c3x sweep 2>&1 | tail -20
```

Review the output. If `kanna-mcp.ts`, `types.ts`, `tools.ts`, `KannaTranscript.tsx`, or new client components require C3 doc updates (new public contracts, tool names, component boundaries), run `/c3 change`.

- [ ] **Step 5: Final commit if C3 docs updated**

```bash
git add .c3/
git commit -m "docs(c3): update component docs for preview_file feature"
```

---

## Self-Review: Spec Coverage Check

| Spec requirement | Task covering it |
|-----------------|-----------------|
| `inferAttachmentContentType` learns image/pdf/audio/video/mermaid MIME | Task 1 |
| Previewability gate rejects `octet-stream`/archives with actionable error | Task 2 |
| `resolveWorkspaceFile` uses `buildLocalFileContentUrl` (not project-scoped) | Task 2 |
| `preview_file` tool registered in `buildKannaMcpTools` | Task 2 |
| `PreviewFileToolCall`, `PreviewFileToolResult`, `HydratedPreviewFileToolCall` types | Task 3 |
| `PREVIEW_FILE_TOOL_NAME` exported from `tools.ts` | Task 3 |
| `normalizeToolCall` maps `mcp__kanna__preview_file` → `toolKind: "preview_file"` | Task 3 |
| `hydrateToolResult` hydrates `preview_file` result | Task 3 |
| `KANNA_SYSTEM_PROMPT_BASE` includes `preview_file` nudge | Task 4 |
| `PreviewOrigin` union includes `"preview_file"` | Task 5 |
| `AttachmentIconKind` includes `"mermaid"` | Task 5 |
| `.mmd`/`.mermaid`/`text/vnd.mermaid` → `mermaid` icon kind | Task 5 |
| `MermaidBody.tsx` — text fetch → `MermaidDiagram` | Task 5 |
| `pickBody` routes `mermaid` iconKind → `MermaidBody` | Task 5 |
| `origin === "preview_file"` shows Share only (no Download) | Task 5 (FilePreviewSheet.test) |
| `PreviewFileMessage` — HEAD probe, ready/missing states, no `<a download>` | Task 6 |
| `renderForLoopCheck` passes for `PreviewFileMessage` | Task 6 |
| `mcp__kanna__preview_file` in `SPECIAL_TOOL_NAMES` | Task 7 |
| `toolKind === "preview_file"` renders `<PreviewFileMessage>` | Task 7 |
| Regression test: preview_file not collapsed between bash calls | Task 7 |
