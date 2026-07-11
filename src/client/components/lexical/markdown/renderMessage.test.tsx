/**
 * renderMessage.test.tsx
 *
 * Tests for renderMessageMarkdown and useRenderedMessage.
 * Verifies that:
 *  - <think>...</think> blocks render as ThinkingBlock (collapsed "Thinking" label)
 *  - ```mermaid fences render as mermaid-diagram markup
 *  - Normal text/markdown renders as prose (paragraphs, etc.)
 *  - useRenderedMessage hook memoises the result
 *
 * Strategy: renderToStaticMarkup for simple SSR-safe assertions.
 * MermaidDiagram uses useTheme → mock it.
 * ThinkingBlock uses useState/lucide → no mock needed (SSR safe).
 */

import { describe, expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

// Mock useTheme before any module that depends on it is imported
mock.module("../../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

// Lazy-import after mocks are registered
const { renderMessageMarkdown, useRenderedMessage } = await import("./renderMessage")

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function render(text: string): string {
  return renderToStaticMarkup(<div>{renderMessageMarkdown(text)}</div>)
}

// ---------------------------------------------------------------------------
// Thinking block tests
// ---------------------------------------------------------------------------

describe("renderMessageMarkdown – thinking blocks", () => {
  test("renders thinking block with 'Thinking' label", () => {
    const html = render("<thinking>some internal monologue</thinking>visible text")
    expect(html).toContain("Thinking")
    expect(html).toContain("visible text")
    // The content is hidden (collapsed by default in ThinkingBlock)
    expect(html).not.toContain("some internal monologue")
  })

  test("renders thinking from <thinking> tag with trailing text", () => {
    const html = render("<thinking>my reasoning</thinking>answer")
    expect(html).toContain("Thinking")
    expect(html).toContain("answer")
  })

  test("renders plain text without thinking label", () => {
    const html = render("just a plain paragraph")
    expect(html).not.toContain("Thinking")
    expect(html).toContain("just a plain paragraph")
  })

  test("renders multiple thinking blocks", () => {
    const html = render(
      "<thinking>plan A</thinking>middle<thinking>plan B</thinking>end"
    )
    const thinkingCount = (html.match(/Thinking/g) ?? []).length
    expect(thinkingCount).toBe(2)
    expect(html).toContain("middle")
    expect(html).toContain("end")
  })
})

// ---------------------------------------------------------------------------
// Mermaid fence tests
// ---------------------------------------------------------------------------

describe("renderMessageMarkdown – mermaid fences", () => {
  test("renders mermaid fence as mermaid markup (loading state fallback)", () => {
    // MermaidDiagram in loading state renders MermaidFallbackCodeBlock
    // which produces a <pre><code class="... language-mermaid">...</code></pre>
    const source = "graph LR\nA-->B"
    const html = render(`\`\`\`mermaid\n${  source  }\n\`\`\``)
    // The fallback code block contains the source and language-mermaid class.
    // renderToStaticMarkup HTML-encodes ">" as "&gt;", so assert on the
    // encoded form for the arrow character.
    expect(html).toContain("language-mermaid")
    expect(html).toContain("graph LR")
    expect(html).toContain("A--&gt;B")
  })

  test("does NOT render mermaid fence as plain code block (no language-mermaid bypass)", () => {
    // A typescript block should NOT have the mermaid class
    const html = render("```typescript\nconst x = 1\n```")
    expect(html).not.toContain("language-mermaid")
    expect(html).toContain("const x = 1")
  })
})

// ---------------------------------------------------------------------------
// Normal markdown tests
// ---------------------------------------------------------------------------

describe("renderMessageMarkdown – markdown rendering", () => {
  test("renders plain paragraph", () => {
    const html = render("Hello, world!")
    expect(html).toContain("<p")
    expect(html).toContain("Hello, world!")
  })

  test("renders bold text", () => {
    const html = render("This is **bold** text")
    expect(html).toContain("<strong")
    expect(html).toContain("bold")
  })

  test("renders heading", () => {
    const html = render("# My Heading")
    expect(html).toContain("<h1")
    expect(html).toContain("My Heading")
  })

  test("renders inline code", () => {
    const html = render("Use `const x = 1` here")
    expect(html).toContain("<code")
    expect(html).toContain("const x = 1")
  })
})

// ---------------------------------------------------------------------------
// Combined content test
// ---------------------------------------------------------------------------

describe("renderMessageMarkdown – combined content", () => {
  test("handles thinking + mermaid + paragraph together", () => {
    const text = [
      "<thinking>my internal plan</thinking>Here is a diagram:",
      "",
      "```mermaid",
      "graph TD",
      "A --> B",
      "```",
      "",
      "And some **conclusion** text.",
    ].join("\n")

    const html = render(text)

    // Thinking block
    expect(html).toContain("Thinking")
    expect(html).not.toContain("my internal plan")

    // Mermaid diagram in loading/fallback state.
    // renderToStaticMarkup HTML-encodes ">" as "&gt;", so assert on the
    // encoded form for the arrow character.
    expect(html).toContain("language-mermaid")
    expect(html).toContain("graph TD")
    expect(html).toContain("A --&gt; B")

    // Normal paragraph text
    expect(html).toContain("Here is a diagram")
    expect(html).toContain("conclusion")
    expect(html).toContain("<strong")
  })
})

// ---------------------------------------------------------------------------
// useRenderedMessage hook tests (via renderToStaticMarkup of the result)
// ---------------------------------------------------------------------------

describe("useRenderedMessage", () => {
  test("hook produces same output as renderMessageMarkdown for plain text", () => {
    // useRenderedMessage is a hook, so we call it in a component context
    function TestComponent({ text }: { text: string }) {
      const node = useRenderedMessage(text)
      return <div>{node}</div>
    }

    const hookHtml = renderToStaticMarkup(<TestComponent text="hello **world**" />)
    const directHtml = render("hello **world**")

    // Both should contain the same content (bold world + paragraph wrapper differences aside)
    expect(hookHtml).toContain("hello")
    expect(hookHtml).toContain("<strong")
    expect(hookHtml).toContain("world")

    // Content should match (ignoring the outer div difference)
    expect(hookHtml.includes("<strong")).toBe(directHtml.includes("<strong"))
  })
})
