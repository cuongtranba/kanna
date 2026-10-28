import { describe, expect, test } from "vite-plus/test"
import { parseClientCommand } from "../commands"
import type { JsonValue } from "../json"

function parseCardFields(cardFields: JsonValue) {
  return parseClientCommand({ type: "board.update", boardId: "board-1", cardFields })
}

describe("board.update cardFields at the command boundary", () => {
  const FIELD = { id: "priority", label: "Priority", kind: "select", required: false, options: [] }

  test("accepts a field that leaves out the keys it does not need", () => {
    expect(parseCardFields([{ id: "notes", label: "Notes", kind: "text" }]).ok).toBe(true)
    expect(parseCardFields([{ ...FIELD, options: [{ id: "high", label: "High" }] }]).ok).toBe(true)
  })

  test("rejects an unknown kind", () => {
    expect(parseCardFields([{ id: "n", label: "N", kind: "currency", options: null, required: false }]).ok).toBe(false)
  })

  test("rejects an option colour outside the board palette", () => {
    expect(
      parseCardFields([{ ...FIELD, options: [{ id: "high", label: "High", colorToken: "chartreuse" }] }]).ok,
    ).toBe(false)
  })

  test("rejects a required flag that is not a boolean", () => {
    expect(parseCardFields([{ ...FIELD, required: "yes" }]).ok).toBe(false)
  })

  test("rejects anything that is not an array of records", () => {
    expect(parseCardFields(null).ok).toBe(false)
    expect(parseCardFields({}).ok).toBe(false)
    expect(parseCardFields(["priority"]).ok).toBe(false)
    expect(parseCardFields("not a schema").ok).toBe(false)
  })

  test("refuses a whole schema when one entry is ragged", () => {
    expect(
      parseCardFields([{ id: "ok", label: "Ok", kind: "text", options: null, required: false }, { id: 7 }]).ok,
    ).toBe(false)
  })
})
