import { describe, expect, test } from "bun:test"
import { installDomShim, parseMermaid } from "./mermaid-parse.adapter"

// The diagram from the report that motivated the validation gate (a kiosk
// deployment flow). Line 5 closes `[/` with `/]` by accident, so it parses;
// line 6 closes with a bare `]` and mermaid's trapText state has no rule for
// it. Keep it verbatim — it is the regression this whole gate exists for.
const KIOSK_DIAGRAM = [
  "flowchart TD",
  "  CI[CI build kiosk-app] --> Artifact[Signed AppImage + sha256 + version]",
  "  Artifact --> CIB[CIB kiosk artifact storage]",
  "  CIB --> CS[Cockpit-Setup]",
  "  CS --> Install[/opt/cubedoc-kiosk-app/releases/<version>/]",
  "  Install --> Current[/opt/cubedoc-kiosk-app/current symlink]",
  "  Current --> Systemd[systemd user/service or kiosk session]",
  "  Systemd --> Electron[kiosk-app Electron]",
  "  CS --> CIBReport[Report installed version/status to CIB]",
].join("\n")

const KIOSK_DIAGRAM_FIXED = KIOSK_DIAGRAM.replace(
  "Current[/opt/cubedoc-kiosk-app/current symlink]",
  'Current["/opt/cubedoc-kiosk-app/current symlink"]',
)

describe("installDomShim", () => {
  test("populates the surface mermaid's DOMPurify import needs, and restores it", () => {
    const bag: Record<string, unknown> = {}
    const restore = installDomShim(bag)

    expect(typeof bag.document).toBe("object")
    expect(typeof bag.window).toBe("object")
    expect(typeof bag.NodeFilter).toBe("object")

    restore()
    expect(Object.keys(bag)).toEqual([])
  })

  test("restores a pre-existing value rather than deleting it", () => {
    const sentinel = { mine: true }
    const bag: Record<string, unknown> = { window: sentinel }

    installDomShim(bag)()

    expect(bag.window).toBe(sentinel)
  })

  // Under `bun test` the happy-dom preload has already registered a real
  // document. Clobbering it would break every client render test sharing the
  // process, so a present document means the shim stands down entirely.
  test("stands down when a real document is already present", () => {
    const realDocument = { nodeType: 9 }
    const bag: Record<string, unknown> = { document: realDocument }

    const restore = installDomShim(bag)
    expect(bag.document).toBe(realDocument)
    expect(bag.window).toBeUndefined()

    restore()
    expect(bag.document).toBe(realDocument)
  })
})

describe("parseMermaid", () => {
  test("rejects the kiosk diagram, blaming the line mermaid blames", async () => {
    const result = await parseMermaid(KIOSK_DIAGRAM)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.raw).toContain("line 6")
    expect(result.raw).toContain("Unrecognized text")
  }, 30_000)

  test("accepts the kiosk diagram once the path label is quoted", async () => {
    expect(await parseMermaid(KIOSK_DIAGRAM_FIXED)).toEqual({ ok: true })
  }, 30_000)

  test.each([
    ["flowchart", "flowchart TD\n  A --> B"],
    ["sequence", "sequenceDiagram\n  A->>B: hi"],
    ["class", "classDiagram\n  class A { +x() }"],
    ["state", "stateDiagram-v2\n  [*] --> S"],
    ["er", "erDiagram\n  A ||--|{ B : has"],
    ["gantt", "gantt\n  title T\n  section S\n  a :a1, 2024-01-01, 1d"],
    ["pie", 'pie title P\n  "a" : 10'],
    ["mindmap", "mindmap\n  root((r))\n    a"],
  ])("accepts a valid %s diagram", async (_name, source) => {
    expect(await parseMermaid(source)).toEqual({ ok: true })
  }, 30_000)

  test("reports text that names no diagram type", async () => {
    const result = await parseMermaid("notadiagram\n  a --> b")
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.raw).toContain("No diagram type detected")
  }, 30_000)

  // The tests above run under the happy-dom preload, so they exercise
  // mermaid but NOT the shim. Production has no happy-dom — this spawns a bun
  // with no preload, which is the only way to prove the server can validate at
  // all. Without it a broken shim would pass CI and silently disable the gate.
  test("works in a process with no DOM at all", async () => {
    const script = `
      const { parseMermaid } = await import(${JSON.stringify(
        new URL("./mermaid-parse.adapter.ts", import.meta.url).pathname,
      )})
      const broken = await parseMermaid(${JSON.stringify(KIOSK_DIAGRAM)})
      const fixed = await parseMermaid(${JSON.stringify(KIOSK_DIAGRAM_FIXED)})
      console.log(JSON.stringify({
        brokenOk: broken.ok,
        blamesLine6: !broken.ok && broken.raw.includes("line 6"),
        fixedOk: fixed.ok,
        windowLeaked: typeof globalThis.window !== "undefined",
        documentLeaked: typeof globalThis.document !== "undefined",
      }))
    `
    const proc = Bun.spawn(["bun", "-e", script], {
      cwd: new URL("../..", import.meta.url).pathname,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(JSON.parse(stdout.trim())).toEqual({
      brokenOk: false,
      blamesLine6: true,
      fixedOk: true,
      windowLeaked: false,
      documentLeaked: false,
    })
  }, 60_000)
})
