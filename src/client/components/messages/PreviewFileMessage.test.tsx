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
  test("renders card with file name and friendly type label", () => {
    const html = renderToStaticMarkup(<PreviewFileMessage message={buildMessage()} />)
    expect(html).toContain("Design Spec")
    // displayName "Design Spec" has no extension — text/markdown mime classifies as Markdown
    expect(html).toContain("Markdown")
  })

  test("renders Markdown label when displayName has .md extension", () => {
    const msg = buildMessage({
      result: {
        contentUrl: "/api/local-file?path=%2Fhome%2Fproject%2Fdocs%2Fspec.md",
        relativePath: "docs/spec.md",
        fileName: "spec.md",
        displayName: "spec.md",
        size: 4096,
        mimeType: "text/markdown; charset=utf-8",
      },
    })
    const html = renderToStaticMarkup(<PreviewFileMessage message={msg} />)
    expect(html).toContain("spec.md")
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
