import { expect, test } from "bun:test"
import { join } from "node:path"
import { contrastBetween, oklchLuminance } from "../../shared/design/contrast"
import { parseTokens } from "../../shared/design/tokens"

const CSS_PATH = join(import.meta.dir, "../../..", "src/index.css")
const tokens = parseTokens(await Bun.file(CSS_PATH).text())

const SLOTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8]
const MARK_CONTRAST = 3

const LIGHT_RELIEF_SLOTS = new Set([3, 4, 5])

function markContrast(theme: "light" | "dark", slot: number): number {
  const mark = tokens[theme][`chart-${slot}`]
  const card = tokens[theme].card
  if (!mark || !card) throw new Error(`--chart-${slot} or --card missing in ${theme}`)
  return contrastBetween(oklchLuminance(mark), oklchLuminance(card))
}

test("every chart series slot reaches 3:1 against the card in dark mode", () => {
  const weak = SLOTS.filter((slot) => markContrast("dark", slot) < MARK_CONTRAST)
  expect(weak).toEqual([])
})

test("in light mode only the documented relief slots fall below 3:1, and each still needs its relief", () => {
  const weak = SLOTS.filter((slot) => markContrast("light", slot) < MARK_CONTRAST)
  expect(weak).toEqual([...LIGHT_RELIEF_SLOTS])
})
