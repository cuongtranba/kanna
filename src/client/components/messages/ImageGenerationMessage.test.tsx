import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedImageGenerationToolCall } from "../../../shared/types"
import { ImageGenerationMessage } from "./ImageGenerationMessage"

// NOTE: Adjusted from spec factory because:
// - ImageGenerationToolCall["input"] is { revisedPrompt?: string | null; status?: string } — no "prompt" field
// - ImageGenerationToolResult is { contentUrl: string; relativePath: string; fileName: string }
//   — no "displayName", "mimeType", or "size" fields
function buildMessage(overrides: Partial<HydratedImageGenerationToolCall> = {}): HydratedImageGenerationToolCall {
  return {
    id: "msg-1", timestamp: new Date(0).toISOString(),
    kind: "tool", toolKind: "image_generation", toolName: "mcp__kanna__image_generation",
    toolId: "t-1",
    input: { revisedPrompt: "Revised prompt", status: "completed" },
    rawResult: undefined, isError: false,
    result: { contentUrl: "/api/x.png", relativePath: "x.png", fileName: "x.png" },
    ...overrides,
  }
}

describe("ImageGenerationMessage", () => {
  test("pending status renders placeholder copy", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      input: { revisedPrompt: "Pending here", status: "in_progress" },
      result: undefined,
    })} />)
    expect(html).toContain("Generating image")
    expect(html).toContain("Pending here")
  })

  test("error path renders error block", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({ isError: true, result: undefined })} />)
    expect(html).toContain("Image generation failed")
  })

  test("completed renders an image preview card with revisedPrompt caption", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage()} />)
    expect(html).toContain('src="/api/x.png"')
    expect(html).toContain("Revised prompt")
  })
})
