import "../../lib/testing/setupHappyDom"
import { expect, test, mock, afterEach } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { makeFakeClipboardPort } from "../../adapters/testing/makeFakePorts"

mock.module("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "light", theme: "light", setTheme: () => {} }),
}))

const { MermaidFallbackCodeBlock } = await import("./shared")

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

async function render(node: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container!)
    root.render(node)
  })
}

test("MermaidFallbackCodeBlock renders source inside a pre/code block", () => {
  const html = renderToStaticMarkup(
    <MermaidFallbackCodeBlock source={"graph TD\nA-->B"} />
  )
  expect(html).toContain("<pre")
  expect(html).toContain("graph TD")
  expect(html).toContain("A--&gt;B")
})

test("MermaidFallbackCodeBlock numbers every line when highlightLine is set", () => {
  const html = renderToStaticMarkup(
    <MermaidFallbackCodeBlock source={"graph TD\nA-->B\nB-->C"} highlightLine={2} />
  )
  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain("graph TD")
  expect(html).toContain("B--&gt;C")
})

test("MermaidFallbackCodeBlock copies the source without the line-number gutter", async () => {
  const clipboard = makeFakeClipboardPort()
  const source = "graph TD\nA-->B\nB-->C"
  await render(
    <MermaidFallbackCodeBlock source={source} highlightLine={2} ports={{ clipboard }} />
  )

  const copy = container!.querySelector('[aria-label="Copy code"]') as HTMLButtonElement
  expect(copy).not.toBeNull()
  await act(async () => { copy.click() })

  expect(clipboard.clipboard).toBe(source)
})
