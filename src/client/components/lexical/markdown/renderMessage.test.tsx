
import { describe, expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("../../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const { renderMessageMarkdown, useRenderedMessage } = await import("./renderMessage")


function render(text: string): string {
  return renderToStaticMarkup(<div>{renderMessageMarkdown(text)}</div>)
}


describe("renderMessageMarkdown – thinking blocks", () => {
  test("renders thinking block with 'Thinking' label", () => {
    const html = render("<thinking>some internal monologue</thinking>visible text")
    expect(html).toContain("Thinking")
    expect(html).toContain("visible text")
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


describe("renderMessageMarkdown – mermaid fences", () => {
  test("renders mermaid fence as mermaid markup (loading state fallback)", () => {
    const source = "graph LR\nA-->B"
    const html = render(`\`\`\`mermaid\n${  source  }\n\`\`\``)
    expect(html).toContain("language-mermaid")
    expect(html).toContain("graph LR")
    expect(html).toContain("A--&gt;B")
  })

  test("does NOT render mermaid fence as plain code block (no language-mermaid bypass)", () => {
    const html = render("```typescript\nconst x = 1\n```")
    expect(html).not.toContain("language-mermaid")
    expect(html).toContain("const x = 1")
  })
})


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

    expect(html).toContain("Thinking")
    expect(html).not.toContain("my internal plan")

    expect(html).toContain("language-mermaid")
    expect(html).toContain("graph TD")
    expect(html).toContain("A --&gt; B")

    expect(html).toContain("Here is a diagram")
    expect(html).toContain("conclusion")
    expect(html).toContain("<strong")
  })
})


describe("useRenderedMessage", () => {
  test("hook produces same output as renderMessageMarkdown for plain text", () => {
    function TestComponent({ text }: { text: string }) {
      const node = useRenderedMessage(text)
      return <div>{node}</div>
    }

    const hookHtml = renderToStaticMarkup(<TestComponent text="hello **world**" />)
    const directHtml = render("hello **world**")

    expect(hookHtml).toContain("hello")
    expect(hookHtml).toContain("<strong")
    expect(hookHtml).toContain("world")

    expect(hookHtml.includes("<strong")).toBe(directHtml.includes("<strong"))
  })
})
