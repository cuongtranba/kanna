import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { resolveEffectiveScaleStep, resolveTypographyVars } from "../../shared/design/typography"

// Pins the SHIPPED pre-paint snippet in index.html to the pure oracle
// (resolveEffectiveScaleStep + resolveTypographyVars). This test executes the
// literal inline <script> body extracted from index.html — never a copy of
// it — so any drift between the shipped snippet and the pure module fails here.

const HTML_PATH = join(import.meta.dir, "../../..", "index.html")
const html = await Bun.file(HTML_PATH).text()

/** Extracts the body of the first plain (non-`type="module"`) inline <script>. */
function extractBlockingScript(source: string): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(source)
  if (!match) throw new Error("expected a plain <script> block (no type attribute) in index.html")
  return match[1]
}

const scriptBody = extractBlockingScript(html)

interface StyleStub {
  props: Record<string, string>
  colorScheme: string
  setProperty(prop: string, value: string): void
}

function makeStyleStub(): StyleStub {
  return {
    // Mirrors the CSS fallback `var(--kanna-font-scale, 1)` — the value the
    // property "reads as" when the pre-paint script never touches it.
    props: { "--kanna-font-scale": "1" },
    colorScheme: "",
    setProperty(prop, value) {
      this.props[prop] = value
    },
  }
}

interface FakeDocumentElement {
  classList: { toggle(name: string, force: boolean): void }
  style: StyleStub
}

interface FakeDocument {
  documentElement: FakeDocumentElement
  querySelector(selector: string): null
}

interface FakeWindow {
  matchMedia(query: string): { matches: boolean }
}

interface FakeLocalStorage {
  getItem(key: string): string | null
}

/**
 * Executes the shipped inline script against fakes and returns the resulting
 * `--kanna-font-scale` property map (never a hardcoded single-key read — the
 * whole recorded map is compared against the pure module's map).
 */
function runPrePaintScript(storedValue: string | null): Record<string, string> {
  const style = makeStyleStub()
  const documentElement: FakeDocumentElement = { classList: { toggle: () => {} }, style }
  const document: FakeDocument = { documentElement, querySelector: () => null }
  const window: FakeWindow = { matchMedia: () => ({ matches: false }) }
  const localStorage: FakeLocalStorage = { getItem: () => storedValue }

  const runner = new Function("window", "document", "localStorage", scriptBody)
  runner(window, document, localStorage)

  return style.props
}

function oracle(deviceOverride: unknown, serverDefault: unknown): Record<string, string> {
  return resolveTypographyVars({ scale: resolveEffectiveScaleStep(deviceOverride, serverDefault) })
}

function envelope(state: Record<string, unknown>, version = 2): string {
  return JSON.stringify({ state, version })
}

describe("index.html pre-paint script — --kanna-font-scale (P6)", () => {
  test("no blob in localStorage leaves the document at the CSS default", () => {
    const result = runPrePaintScript(null)
    expect(result).toEqual(oracle(undefined, undefined))
  })

  test("malformed JSON leaves the document at the CSS default", () => {
    const result = runPrePaintScript("{not json")
    expect(result).toEqual(oracle(undefined, undefined))
  })

  test("version-1 blob with no typography keys leaves the document at the CSS default", () => {
    const result = runPrePaintScript(envelope({ autoResumeOnRateLimit: true }, 1))
    expect(result).toEqual(oracle(undefined, undefined))
  })

  test("device override only is applied", () => {
    const result = runPrePaintScript(envelope({ typographyOverride: "xl" }))
    expect(result).toEqual(oracle("xl", undefined))
    expect(result["--kanna-font-scale"]).toBe("1.25")
  })

  test("server default cache only is applied", () => {
    const result = runPrePaintScript(envelope({ typographyServerDefaultCache: "sm" }))
    expect(result).toEqual(oracle(undefined, "sm"))
    expect(result["--kanna-font-scale"]).toBe("0.875")
  })

  test("override wins over cache when both are present", () => {
    const result = runPrePaintScript(envelope({ typographyOverride: "xxl", typographyServerDefaultCache: "sm" }))
    expect(result).toEqual(oracle("xxl", "sm"))
    // The headline proof this task exists for: a seeded xxl override yields
    // --kanna-font-scale: "1.5" before any React code runs.
    expect(result["--kanna-font-scale"]).toBe("1.5")
  })

  test("a garbage step value falls back to the CSS default", () => {
    const result = runPrePaintScript(envelope({ typographyOverride: "not-a-real-step" }))
    expect(result).toEqual(oracle("not-a-real-step", undefined))
    expect(result["--kanna-font-scale"]).toBe("1")
  })
})
