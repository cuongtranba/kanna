import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedImageGenerationToolCall } from "../../../shared/types"
import { ImageGenerationMessage } from "./ImageGenerationMessage"

function buildMessage(overrides: Partial<HydratedImageGenerationToolCall> = {}): HydratedImageGenerationToolCall {
  return {
    id: "msg-1",
    timestamp: new Date(0).toISOString(),
    kind: "tool",
    toolKind: "image_generation",
    toolName: "ImageGeneration",
    toolId: "tool-1",
    input: { revisedPrompt: "Tom chasing Jerry", status: "completed" },
    rawResult: undefined,
    isError: false,
    result: {
      contentUrl: "/api/projects/p1/files/generated_images/abc.png/content",
      relativePath: "generated_images/abc.png",
      fileName: "abc.png",
    },
    ...overrides,
  }
}

describe("ImageGenerationMessage", () => {
  test("renders <img> with contentUrl and revisedPrompt caption when completed", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage()} />)
    expect(html).toContain('data-testid="image-generation"')
    expect(html).toContain('src="/api/projects/p1/files/generated_images/abc.png/content"')
    expect(html).toContain('alt="Tom chasing Jerry"')
    expect(html).toContain("Tom chasing Jerry")
  })

  test("renders pending UI when status is in_progress and no result", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      input: { revisedPrompt: null, status: "in_progress" },
      result: undefined,
    })} />)
    expect(html).toContain('data-testid="image-generation-pending"')
    expect(html).toContain("Generating image")
  })

  test("renders error UI when isError is true", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      isError: true,
    })} />)
    expect(html).toContain('data-testid="image-generation-error"')
    expect(html).toContain("Image generation failed")
  })

  test("renders error UI when status is failed", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      input: { revisedPrompt: "x", status: "failed" },
    })} />)
    expect(html).toContain('data-testid="image-generation-error"')
  })

  test("renders error UI when contentUrl is empty", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      result: { contentUrl: "", relativePath: "x.png", fileName: "x.png" },
    })} />)
    expect(html).toContain('data-testid="image-generation-error"')
  })

  test("falls back to fileName for alt when revisedPrompt missing", () => {
    const html = renderToStaticMarkup(<ImageGenerationMessage message={buildMessage({
      input: { revisedPrompt: null, status: "completed" },
    })} />)
    expect(html).toContain('alt="abc.png"')
  })
})
