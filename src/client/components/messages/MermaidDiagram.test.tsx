import "../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, afterEach } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

let lastInitTheme: string | null = null
let themeValue: "light" | "dark" = "light"

mock.module("../../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: themeValue, theme: themeValue, setTheme: () => {} }),
}))
mock.module("mermaid", () => ({
  default: {
    initialize: (cfg: { theme: string }) => { lastInitTheme = cfg.theme },
    render: async (_id: string, text: string) => {
      if (text.includes("INVALID")) throw new Error("parse error")
      return { svg: `<svg data-mermaid="1">${text}</svg>` }
    },
  },
}))

const { MermaidDiagram } = await import("./MermaidDiagram")

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = null
  container = null
})

async function renderAndSettle(node: React.ReactElement) {
  container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container!)
    root.render(node)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe("MermaidDiagram", () => {
  test("renders the mermaid SVG for valid source", async () => {
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(container!.innerHTML).toContain("data-mermaid")
    expect(container!.innerHTML).toContain("<svg")
  })

  test("falls back to a code block when mermaid render throws", async () => {
    await renderAndSettle(<MermaidDiagram source={"INVALID DIAGRAM"} />)
    expect(container!.innerHTML).toContain("<pre")
    expect(container!.innerHTML).toContain("INVALID DIAGRAM")
    expect(container!.innerHTML).not.toContain("data-mermaid")
  })

  test("passes mermaid theme 'dark' when resolvedTheme is dark", async () => {
    themeValue = "dark"
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(lastInitTheme).toBe("dark")
    themeValue = "light"
  })

  test("passes mermaid theme 'default' when resolvedTheme is light", async () => {
    themeValue = "light"
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(lastInitTheme).toBe("default")
  })
})
