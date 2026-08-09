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

// A parse error is only useful if the reader can find the offending line. The
// raw jison message is three lines with a caret ruler; flattened into prose in
// a proportional font it pointed at nothing and named a line the reader had no
// way to count to.
describe("MermaidDiagram — parse-error diagnostics", () => {
  const ER_SOURCE = [
    "erDiagram",
    "  TENANT_SETTINGS {",
    "    uuid tenant_id PK",
    "    jsonb quotas",
    "  }",
  ].join("\n")

  const JISON_ERROR = [
    "Parse error on line 5:",
    "... jsonb quotas  }  TENANT_SECRETS {",
    "--------------------^",
    "Expecting 'ATTRIBUTE_WORD', got 'BLOCK_STOP'",
  ].join("\n")

  const failingMermaid = async () => ({
    initialize: () => {},
    render: async () => { throw new Error(JISON_ERROR) },
  })

  test("names the failing line and the cause separately", async () => {
    await renderAndSettle(
      <MermaidDiagram source={ER_SOURCE} ports={{ loadMermaid: failingMermaid }} />
    )
    expect(container!.textContent).toContain("line 5")
    expect(container!.textContent).toContain("Expecting 'ATTRIBUTE_WORD', got 'BLOCK_STOP'")
  })

  test("renders the caret excerpt in a monospace block so it stays aligned", async () => {
    await renderAndSettle(
      <MermaidDiagram source={ER_SOURCE} ports={{ loadMermaid: failingMermaid }} />
    )
    const excerpt = Array.from(container!.querySelectorAll("pre")).find((el) =>
      (el.textContent ?? "").includes("^")
    )
    expect(excerpt).toBeDefined()
    expect(excerpt!.className).toContain("font-mono")
    expect(excerpt!.className).toContain("whitespace-pre")
    // Both excerpt lines survive as real newlines — collapsing them is the bug.
    expect(excerpt!.textContent).toBe(
      "... jsonb quotas  }  TENANT_SECRETS {\n--------------------^"
    )
  })

  test("numbers the fallback source lines and marks the reported one", async () => {
    await renderAndSettle(
      <MermaidDiagram source={ER_SOURCE} ports={{ loadMermaid: failingMermaid }} />
    )
    const gutter = Array.from(container!.querySelectorAll("code span")).filter(
      (el) => el.getAttribute("aria-hidden") === "true"
    )
    expect(gutter.map((el) => el.textContent)).toEqual(["1", "2", "3", "4", "5"])
    const marked = gutter.find((el) => el.textContent === "5")
    expect(marked!.className).toContain("text-destructive")
    expect(gutter[0]!.className).not.toContain("text-destructive")
  })

  test("omits the gutter when the error names no line", async () => {
    const loadMermaid = async () => ({
      initialize: () => {},
      render: async () => { throw new Error("No diagram type detected") },
    })
    await renderAndSettle(
      <MermaidDiagram source={ER_SOURCE} ports={{ loadMermaid }} />
    )
    expect(container!.querySelector('code span[aria-hidden="true"]')).toBeNull()
    expect(container!.textContent).toContain("No diagram type detected")
  })
})

// A model asked for a dotted crossed edge writes `-.x`; mermaid spells it
// `-.-x` and rejects the whole diagram over the missing dash. Rendering the
// repaired copy beats showing the reader a parse error for a typo — provided
// the UI still says the source it is showing is not what was rendered.
describe("MermaidDiagram — link repair", () => {
  const BROKEN = "flowchart LR\n  B -.x|discarded| N[nothing]"

  /** Rejects the invalid spelling; `-.-x` does not contain `-.x`, so the repair passes. */
  const strictMermaid = async () => ({
    initialize: () => {},
    render: async (_id: string, text: string) => {
      if (text.includes("-.x")) throw new Error("Parse error on line 3:\nExpecting 'PIPE'")
      return { svg: `<svg data-mermaid="1">${text}</svg>` }
    },
  })

  test("renders the repaired diagram instead of a parse error", async () => {
    await renderAndSettle(<MermaidDiagram source={BROKEN} ports={{ loadMermaid: strictMermaid }} />)
    expect(container!.innerHTML).toContain("data-mermaid")
    expect(container!.innerHTML).toContain("-.-x")
    expect(container!.textContent).not.toContain("Couldn't render this Mermaid diagram")
  })

  test("discloses the correction rather than passing it off as the author's diagram", async () => {
    await renderAndSettle(<MermaidDiagram source={BROKEN} ports={{ loadMermaid: strictMermaid }} />)
    expect(container!.textContent).toContain("Corrected")
    expect(container!.textContent).toContain("1 invalid link")
    expect(container!.textContent).toContain("-.x → -.-x")
    expect(container!.textContent).toContain("The source is unchanged")
  })

  test("leaves a diagram mermaid accepts untouched and says nothing", async () => {
    const valid = "flowchart LR\n  A --> B"
    await renderAndSettle(<MermaidDiagram source={valid} ports={{ loadMermaid: strictMermaid }} />)
    expect(container!.innerHTML).toContain("data-mermaid")
    expect(container!.textContent).not.toContain("Corrected")
  })

  test("reports the ORIGINAL error when the repaired copy fails too", async () => {
    // The reported line and caret refer to the authored source shown below the
    // message; surfacing the repaired copy's error would point at a phantom.
    const alwaysFails = async () => ({
      initialize: () => {},
      render: async (_id: string, text: string) => {
        if (text.includes("-.-x")) throw new Error("Parse error on line 99:\nrepaired-copy failure")
        throw new Error("Parse error on line 2:\nauthored-source failure")
      },
    })
    await renderAndSettle(<MermaidDiagram source={BROKEN} ports={{ loadMermaid: alwaysFails }} />)
    expect(container!.textContent).toContain("authored-source failure")
    expect(container!.textContent).not.toContain("repaired-copy failure")
    expect(container!.textContent).toContain("line 2")
  })

  test("does not retry when the source has no known defect to repair", async () => {
    let renders = 0
    const counting = async () => ({
      initialize: () => {},
      render: async () => {
        renders += 1
        throw new Error("Parse error on line 1:\nunrelated")
      },
    })
    await renderAndSettle(<MermaidDiagram source={"erDiagram\n  A {"} ports={{ loadMermaid: counting }} />)
    expect(renders).toBe(1)
  })
})
