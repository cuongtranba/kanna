import "../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, afterEach } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { makeFakeDomPort } from "../../adapters/testing/makeFakePorts"

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
  themeValue = "light"
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

  test("shows an error badge with the parse message when render throws", async () => {
    await renderAndSettle(<MermaidDiagram source={"INVALID DIAGRAM"} />)
    expect(container!.textContent).toContain("Couldn't render this Mermaid diagram")
    expect(container!.textContent).toContain("parse error")
  })

  test("passes mermaid theme 'dark' when resolvedTheme is dark", async () => {
    themeValue = "dark"
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(lastInitTheme).toBe("dark")
  })

  test("passes mermaid theme 'default' when resolvedTheme is light", async () => {
    themeValue = "light"
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(lastInitTheme).toBe("default")
  })

  test("view-source toggle swaps rendered SVG for raw source", async () => {
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(container!.innerHTML).toContain("data-mermaid")
    const toggle = container!.querySelector('[aria-label="View diagram source"]') as HTMLButtonElement
    expect(toggle).not.toBeNull()
    await act(async () => { toggle.click() })
    expect(container!.innerHTML).toContain("<pre")
    expect(container!.innerHTML).not.toContain("data-mermaid")
  })

  test("has a copy-source control", async () => {
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    expect(container!.querySelector('[aria-label="Copy diagram source"]')).not.toBeNull()
  })

  test("opens the zoom modal from the zoom control", async () => {
    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} />)
    const zoom = container!.querySelector('[aria-label="Zoom diagram"]') as HTMLButtonElement
    expect(zoom).not.toBeNull()
    await act(async () => { zoom.click() })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  test("does not trigger a React render loop", async () => {
    const result = await renderForLoopCheck(<MermaidDiagram source={"graph TD\nA-->B"} />)
    await result.cleanup()
    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
  })
})

// Regression suite for the stale-chunk incident: a tab left open across a deploy
// requests a hashed mermaid chunk the new build no longer ships, so `import("mermaid")`
// rejects. See src/client/lib/lazyModule.ts.
describe("MermaidDiagram — stale chunk after a deploy", () => {
  const STALE_CHUNK_MESSAGE =
    "Failed to fetch dynamically imported module: http://localhost:3210/assets/mermaid.core-BxJivhhJ.js"

  const workingMermaid = {
    initialize: () => {},
    render: async (_id: string, text: string) => ({ svg: `<svg data-mermaid="1">${text}</svg>` }),
  }

  test("tells the user the app needs reloading instead of blaming the diagram", async () => {
    const loadMermaid = async () => {
      throw new Error(STALE_CHUNK_MESSAGE)
    }
    await renderAndSettle(
      <MermaidDiagram source={"graph TD\nA-->B"} ports={{ loadMermaid }} />
    )

    expect(container!.textContent).toContain("latest version")
    // The raw module-loader message is noise for the user.
    expect(container!.textContent).not.toContain("Failed to fetch dynamically imported module")
  })

  test("offers a reload control that calls dom.reload()", async () => {
    const dom = makeFakeDomPort()
    const loadMermaid = async () => {
      throw new Error(STALE_CHUNK_MESSAGE)
    }
    await renderAndSettle(
      <MermaidDiagram source={"graph TD\nA-->B"} ports={{ loadMermaid, dom }} />
    )

    const reload = container!.querySelector('[aria-label="Reload the app"]') as HTMLButtonElement
    expect(reload).not.toBeNull()
    expect(dom.reloaded).toBe(false)

    await act(async () => { reload.click() })

    expect(dom.reloaded).toBe(true)
  })

  test("still shows the diagram source so nothing is lost", async () => {
    const loadMermaid = async () => {
      throw new Error(STALE_CHUNK_MESSAGE)
    }
    await renderAndSettle(
      <MermaidDiagram source={"graph TD\nA-->B"} ports={{ loadMermaid }} />
    )

    expect(container!.innerHTML).toContain("<pre")
    expect(container!.textContent).toContain("A-->B")
  })

  test("a rejected load is not cached — a later diagram retries and renders", async () => {
    // The core defect: the old loader cached the rejected promise, so once one chunk
    // load failed every later diagram in the tab stayed broken for the life of the tab.
    let calls = 0
    const loadMermaid = async () => {
      calls += 1
      if (calls === 1) throw new Error(STALE_CHUNK_MESSAGE)
      return workingMermaid
    }

    await renderAndSettle(<MermaidDiagram source={"graph TD\nA-->B"} ports={{ loadMermaid }} />)
    expect(container!.textContent).toContain("latest version")

    // A second diagram mounts later (new message arrives, or the user scrolls).
    await act(async () => { root?.unmount() })
    container?.remove()
    await renderAndSettle(<MermaidDiagram source={"graph TD\nC-->D"} ports={{ loadMermaid }} />)

    expect(calls).toBe(2)
    expect(container!.innerHTML).toContain("data-mermaid")
    expect(container!.textContent).not.toContain("latest version")
  })

  test("an ordinary syntax error does NOT offer a reload", async () => {
    const loadMermaid = async () => ({
      initialize: () => {},
      render: async () => { throw new Error("Parse error on line 2") },
    })
    await renderAndSettle(
      <MermaidDiagram source={"graph TD\nA-->B"} ports={{ loadMermaid }} />
    )

    expect(container!.textContent).toContain("Couldn't render this Mermaid diagram")
    expect(container!.textContent).toContain("Parse error on line 2")
    expect(container!.querySelector('[aria-label="Reload the app"]')).toBeNull()
  })

  test("does not trigger a React render loop in the stale-chunk state", async () => {
    const loadMermaid = async () => {
      throw new Error(STALE_CHUNK_MESSAGE)
    }
    const result = await renderForLoopCheck(
      <MermaidDiagram source={"graph TD\nA-->B"} ports={{ loadMermaid }} />
    )
    await result.cleanup()
    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
  })
})
