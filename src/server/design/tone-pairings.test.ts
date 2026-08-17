import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { contrastBetween, compositeOver, oklchLuminance } from "../../shared/design/contrast"
import { parseTokens } from "../../shared/design/tokens"
import { TONE_PAIRINGS } from "../../shared/design/tone-pairings"

const CSS_PATH = join(import.meta.dir, "../../..", "src/index.css")
const css = await Bun.file(CSS_PATH).text()
const tokens = parseTokens(css)

const THEMES = ["light", "dark"] as const
const WCAG_AA = 4.5

function measuredContrast(pairing: { fg: string; bg: string; alpha: number; base: string }, theme: "light" | "dark"): number {
  const map = tokens[theme]
  const fg = map[pairing.fg]
  const bg = map[pairing.bg]
  const base = map[pairing.base]
  if (!fg) throw new Error(`Token not found in ${theme}: --${pairing.fg}`)
  if (!bg) throw new Error(`Token not found in ${theme}: --${pairing.bg}`)
  if (!base) throw new Error(`Token not found in ${theme}: --${pairing.base}`)
  const fgLum = oklchLuminance(fg)
  const bgLum = compositeOver(bg, base, pairing.alpha)
  return contrastBetween(fgLum, bgLum)
}

describe("TONE_PAIRINGS — WCAG AA (4.5:1) in both themes", () => {
  for (const pairing of TONE_PAIRINGS) {
    for (const theme of THEMES) {
      test(`${pairing.name} / ${theme}`, () => {
        const ratio = measuredContrast(pairing, theme)
        expect(
          ratio,
          `${pairing.name} in ${theme}: text-${pairing.fg} on bg-${pairing.bg}/${pairing.alpha * 100} over ${pairing.base} = ${ratio.toFixed(2)}:1 (need ≥${WCAG_AA}:1)`,
        ).toBeGreaterThanOrEqual(WCAG_AA)
      })
    }
  }
})

describe("contrast engine sanity", () => {
  test("near-black on near-white gives high ratio", () => {
    const ratio = measuredContrast(
      { fg: "foreground", bg: "background", alpha: 1, base: "background" },
      "light",
    )
    expect(ratio).toBeGreaterThan(10)
  })

  test("deliberately broken pairing fails the gate", () => {
    const brokenPairing = { fg: "warning-foreground", bg: "warning", alpha: 0.1, base: "card" }
    const darkRatio = measuredContrast(brokenPairing, "dark")
    expect(darkRatio).toBeLessThan(WCAG_AA)
  })
})
