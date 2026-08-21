/**
 * The Lexical heading className map is triplicated across three files
 * (lexical/config.ts, markdown/renderMessage.tsx, markdown/lexicalToReact.tsx)
 * for reasons documented at renderMessage.tsx's file header (each walker is
 * maintained independently). This test pins all three copies equal to each
 * other so they can never silently drift apart again: editing one copy in
 * isolation must fail this test.
 */
import { describe, expect, test } from "bun:test"
import { HEADING_CLASS_MAP as configHeadingClassMap } from "./config"
import { HEADING_CLASS_MAP as renderMessageHeadingClassMap } from "./markdown/renderMessage"
import { HEADING_CLASS_MAP as lexicalToReactHeadingClassMap } from "./markdown/lexicalToReact"

describe("Lexical heading className map — drift lock", () => {
  test("renderMessage.tsx's copy matches config.ts's copy", () => {
    expect(renderMessageHeadingClassMap).toEqual(configHeadingClassMap)
  })

  test("lexicalToReact.tsx's copy matches config.ts's copy", () => {
    expect(lexicalToReactHeadingClassMap).toEqual(configHeadingClassMap)
  })

  test("all three copies declare the same h1-h6 keys", () => {
    const keys = ["h1", "h2", "h3", "h4", "h5", "h6"]
    expect(Object.keys(configHeadingClassMap).sort()).toEqual(keys)
    expect(Object.keys(renderMessageHeadingClassMap).sort()).toEqual(keys)
    expect(Object.keys(lexicalToReactHeadingClassMap).sort()).toEqual(keys)
  })

  test("headings use the scalable --text-N tokens, not arbitrary px utilities", () => {
    for (const map of [configHeadingClassMap, renderMessageHeadingClassMap, lexicalToReactHeadingClassMap]) {
      for (const cls of Object.values(map)) {
        expect(cls).not.toMatch(/text-\[\d+px\]/)
      }
    }
  })
})
