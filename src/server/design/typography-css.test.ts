import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const CSS_PATH = join(import.meta.dir, "../../..", "src/index.css")
const css = await Bun.file(CSS_PATH).text()

function extractBlocks(cssText: string, matchesSelector: (selector: string) => boolean): string[] {
  const blocks: string[] = []
  const headerRe = /([^{}]+)\{/g
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(cssText))) {
    const selector = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!matchesSelector(selector)) continue
    const open = m.index + m[0].length - 1
    let depth = 0
    let end = open
    for (; end < cssText.length; end++) {
      if (cssText[end] === "{") depth++
      else if (cssText[end] === "}") {
        depth--
        if (depth === 0) break
      }
    }
    blocks.push(cssText.slice(open + 1, end))
  }
  return blocks
}

const TEXT_STEPS_PX = [9, 10, 11, 12, 13, 15, 16, 18, 20, 22]

describe("index.css — --kanna-font-scale wiring (P3)", () => {
  test("a bare `html { }` rule sets font-size from var(--kanna-font-scale)", () => {
    const htmlBlocks = extractBlocks(css, (selector) => selector === "html")
    const withFontSize = htmlBlocks.find((body) => /font-size\s*:/.test(body))
    expect(withFontSize, "expected a bare `html { ... }` rule declaring font-size").toBeDefined()
    expect(withFontSize).toMatch(/font-size\s*:\s*calc\(16px\s*\*\s*var\(--kanna-font-scale/)
  })

  test("input, textarea, select scale up from a 16px floor (Mobile-Input-16 Rule)", () => {
    const blocks = extractBlocks(css, (selector) => selector === "input, textarea, select")
    expect(blocks.length, "expected an `input, textarea, select { ... }` rule").toBe(1)
    const body = blocks[0]
    expect(body).toMatch(/font-size\s*:\s*max\(16px,\s*1rem\)/)
  })

  test("all ten --text-N tokens exist, each equal to N / 16 rem", () => {
    const themeBlocks = extractBlocks(css, (selector) => selector === "@theme")
    expect(themeBlocks.length, "expected an @theme block").toBeGreaterThan(0)
    const themeBody = themeBlocks.join("\n")
    for (const n of TEXT_STEPS_PX) {
      const match = new RegExp(`--text-${n}\\s*:\\s*([0-9.]+)rem\\s*;`).exec(themeBody)
      expect(match, `expected --text-${n} to be declared as a rem value in @theme`).not.toBeNull()
      const actualRem = Number(match?.[1])
      expect(actualRem).toBeCloseTo(n / 16, 6)
    }
  })

  test("no --text-N--line-height companion is ever declared", () => {
    expect(css).not.toMatch(/--text-\d+--line-height/)
  })

  test("--diffs-font-size and --shell-top-band are rem-valued, never px", () => {
    const diffsValues = [...css.matchAll(/--diffs-font-size\s*:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(diffsValues.length).toBeGreaterThan(0)
    for (const value of diffsValues) {
      expect(value).toMatch(/rem$/)
      expect(value).not.toMatch(/px/)
    }

    const shellTopBandValues = [...css.matchAll(/--shell-top-band\s*:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(shellTopBandValues.length).toBe(2)
    for (const value of shellTopBandValues) {
      expect(value).toMatch(/rem$/)
      expect(value).not.toMatch(/px/)
    }
  })

  test("body, .font-logo, and code/pre route their font-family through --kanna-font-* vars", () => {
    const bodyBlocks = extractBlocks(css, (selector) => selector === "body")
    const bodyWithFont = bodyBlocks.find((body) => /font-family\s*:/.test(body))
    expect(bodyWithFont, "expected a `body { ... }` rule declaring font-family").toBeDefined()
    expect(bodyWithFont).toMatch(/font-family\s*:\s*var\(--kanna-font-body\)/)

    const fontLogoBlocks = extractBlocks(css, (selector) => selector === ".font-logo")
    expect(fontLogoBlocks.length, "expected a `.font-logo { ... }` rule").toBe(1)
    expect(fontLogoBlocks[0]).toMatch(/font-family\s*:\s*var\(--kanna-font-logo\)/)

    const codePreBlocks = extractBlocks(css, (selector) => selector === "code, pre")
    expect(codePreBlocks.length, "expected a `code, pre { ... }` rule").toBe(1)
    expect(codePreBlocks[0]).toMatch(/font-family\s*:\s*var\(--kanna-font-mono\)/)
  })
})
