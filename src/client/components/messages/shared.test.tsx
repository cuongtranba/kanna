import { expect, test, mock } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

mock.module("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const { MermaidFallbackCodeBlock } = await import("./shared")

test("MermaidFallbackCodeBlock renders source inside a pre/code block", () => {
  const html = renderToStaticMarkup(
    <MermaidFallbackCodeBlock source={"graph TD\nA-->B"} />
  )
  expect(html).toContain("<pre")
  expect(html).toContain("graph TD")
  expect(html).toContain("A--&gt;B")
})
