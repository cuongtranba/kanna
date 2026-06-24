import { expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("../../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const { MessageCodeBlock } = await import("./MessageCodeBlock")

test("renders a copy button and the code text for a fenced block with a language", () => {
  const html = renderToStaticMarkup(
    <MessageCodeBlock source={"const x = 1\n"} lang="js" />,
  )
  expect(html).toContain('aria-label="Copy code"')
  expect(html).toContain("group/pre")
  expect(html).toContain("const x = 1")
})

test("renders plain code (no HighlightedCode) when no language is given", () => {
  const html = renderToStaticMarkup(
    <MessageCodeBlock source={"plain text"} lang="" />,
  )
  expect(html).toContain('aria-label="Copy code"')
  expect(html).toContain("plain text")
  // No language class when lang is empty.
  expect(html).not.toContain("language-")
})
