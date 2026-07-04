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
