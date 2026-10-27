import { describe, expect, test } from "vite-plus/test"
import { HEADING_CLASS_MAP, kannaEditorTheme } from "./config"

describe("Lexical heading className map", () => {
  test("declares the h1-h6 keys", () => {
    expect(Object.keys(HEADING_CLASS_MAP).sort()).toEqual(["h1", "h2", "h3", "h4", "h5", "h6"])
  })

  test("the editor theme and the static renderer read the same map", () => {
    expect(kannaEditorTheme.heading).toBe(HEADING_CLASS_MAP)
  })

  test("headings use the scalable --text-N tokens, not arbitrary px utilities", () => {
    for (const cls of Object.values(HEADING_CLASS_MAP)) {
      expect(cls).not.toMatch(/text-\[\d+px\]/)
    }
  })
})
