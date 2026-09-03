import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { contrastBetween, compositeOver, oklchLuminance } from "../../shared/design/contrast"
import { parseTokens } from "../../shared/design/tokens"
import { STATUS_PILL_CLASS, TONE_PAIRINGS } from "../../shared/design/tone-pairings"

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

test("filled destructive actions are included in the contrast catalog", () => {
  expect(TONE_PAIRINGS.some((pairing) => pairing.name === "action/destructive-filled")).toBe(true)
})

describe("muted editorial text — WCAG AAA (7:1)", () => {
  for (const theme of THEMES) {
    test(theme, () => {
      const ratio = measuredContrast(
        { fg: "muted-foreground", bg: "background", alpha: 1, base: "background" },
        theme,
      )
      expect(ratio).toBeGreaterThanOrEqual(7)
    })
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

describe("the catalog measures what is drawn", () => {
  test("no pairing survives whose consumer was deleted", () => {
    // The four `status/*` tinted pills were the only consumers of those
    // pairings. Keeping them after the pills became marks would leave this
    // suite proving contrast for a surface nothing renders — a check that
    // gates nothing, which is exactly the failure mode this repo removes.
    const names = TONE_PAIRINGS.map((p) => p.name)
    expect(names).not.toContain("status/running")
    expect(names).not.toContain("status/completed")
    expect(names).not.toContain("status/failed")
    expect(names).not.toContain("status/skipped")
  })

  test("every mark colour is measured on the plain surface it actually sits on", () => {
    const marks = TONE_PAIRINGS.filter((p) => p.name.startsWith("mark/"))
    expect(marks.length).toBe(4)
    // A mark is drawn on the card/background itself, never over a tint, so a
    // pairing claiming otherwise would be measuring the wrong composite.
    for (const mark of marks) expect(mark.alpha).toBe(1)
  })

  test("the pill map covers exactly the availabilities that draw one", () => {
    expect(Object.keys(STATUS_PILL_CLASS).sort()).toEqual(["outdated", "partial", "unknown"])
  })
})
