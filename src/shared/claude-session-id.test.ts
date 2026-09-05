import { describe, expect, test } from "bun:test"
import { extractSessionId, extractSessionIds } from "./claude-session-id"

const ID = "4f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"

describe("extractSessionId", () => {
  test("bare uuid", () => expect(extractSessionId(` ${ID} `)).toBe(ID))
  test("uppercase normalized", () => expect(extractSessionId(ID.toUpperCase())).toBe(ID))
  test("filename", () => expect(extractSessionId(`${ID}.jsonl`)).toBe(ID))
  test("full path takes the basename uuid", () =>
    expect(extractSessionId(`/Users/x/.claude/projects/-Users-x-repos-kanna/${ID}.jsonl`)).toBe(ID))
  test("garbage returns null", () => expect(extractSessionId("not-a-uuid")).toBeNull())
  test("empty returns null", () => expect(extractSessionId("  ")).toBeNull())
})

describe("extractSessionIds", () => {
  test("splits on newlines/commas/spaces and dedupes", () => {
    const other = "0f9c2b1e-8a31-4c7d-9b2e-1a2b3c4d5e6f"
    expect(extractSessionIds(`${ID},\n ${other} ${ID}`)).toEqual([ID, other])
  })
  test("empty input yields []", () => expect(extractSessionIds(" \n")).toEqual([]))
})
