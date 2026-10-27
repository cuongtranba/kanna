import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { MessageCodeBlock } from "./MessageCodeBlock"
import { TestThemeProvider } from "../../../lib/testing/TestThemeProvider"

test("renders a copy button and the code text for a fenced block with a language", () => {
  const html = renderToStaticMarkup(
    <TestThemeProvider><MessageCodeBlock source={"const x = 1\n"} lang="js" /></TestThemeProvider>,
  )
  expect(html).toContain('aria-label="Copy code"')
  expect(html).toContain("group/pre")
  expect(html).toContain("const x = 1")
})

test("renders plain code (no HighlightedCode) when no language is given", () => {
  const html = renderToStaticMarkup(
    <TestThemeProvider><MessageCodeBlock source={"plain text"} lang="" /></TestThemeProvider>,
  )
  expect(html).toContain('aria-label="Copy code"')
  expect(html).toContain("plain text")
  expect(html).not.toContain("language-")
})
