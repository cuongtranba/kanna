import { describe, expect, test } from "bun:test"
import type { FieldValue } from "./types"
import {
  decodeActor,
  decodeCardContent,
  decodeFieldDef,
  decodeFieldDefs,
  decodeFieldValue,
  decodeTemplateColumn,
  decodeTemplateDefinition,
  decodeTemplateMapping,
} from "./decode"

describe("decodeFieldValue", () => {
  test("round-trips every value kind", () => {
    const values: FieldValue[] = [
      { kind: "text", value: "hello" },
      { kind: "longtext", value: "body" },
      { kind: "url", value: "https://example.com" },
      { kind: "number", value: 42 },
      { kind: "date", value: 1_700_000_000_000 },
      { kind: "select", optionId: "high" },
      { kind: "select", optionId: null },
      { kind: "multiselect", optionIds: ["a", "b"] },
      { kind: "label", values: ["bug"] },
    ]
    for (const value of values) {
      expect(decodeFieldValue(JSON.parse(JSON.stringify(value)))).toEqual(value)
    }
  })

  test("rejects a value whose payload does not match its kind", () => {
    expect(decodeFieldValue({ kind: "text", value: 5 })).toBeNull()
    expect(decodeFieldValue({ kind: "number", value: "5" })).toBeNull()
    expect(decodeFieldValue({ kind: "select", optionId: 7 })).toBeNull()
  })

  test("rejects a non-finite number and a fractional date", () => {
    // JSON has no Infinity, but a hand-edited row or a future writer might.
    expect(decodeFieldValue({ kind: "number", value: Number.POSITIVE_INFINITY })).toBeNull()
    expect(decodeFieldValue({ kind: "date", value: 1.5 })).toBeNull()
  })

  test("rejects an unknown kind and non-objects", () => {
    expect(decodeFieldValue({ kind: "future-kind", value: "x" })).toBeNull()
    expect(decodeFieldValue(null)).toBeNull()
    expect(decodeFieldValue("text")).toBeNull()
    expect(decodeFieldValue([])).toBeNull()
  })

  test("drops non-string entries from list-shaped values instead of failing", () => {
    expect(decodeFieldValue({ kind: "label", values: ["ok", 5, null] })).toEqual({
      kind: "label",
      values: ["ok"],
    })
    expect(decodeFieldValue({ kind: "multiselect", optionIds: "not-an-array" })).toEqual({
      kind: "multiselect",
      optionIds: [],
    })
  })
})

describe("decodeCardContent", () => {
  test("keeps the readable fields and drops the corrupt ones", () => {
    // One damaged field must never make a whole card unreadable.
    expect(
      decodeCardContent({
        good: { kind: "text", value: "kept" },
        broken: { kind: "text", value: 12 },
        alien: "not even an object",
      }),
    ).toEqual({ good: { kind: "text", value: "kept" } })
  })

  test("returns an empty content map for anything that is not an object", () => {
    expect(decodeCardContent(null)).toEqual({})
    expect(decodeCardContent([1, 2])).toEqual({})
    expect(decodeCardContent("{}")).toEqual({})
  })
})

describe("decodeActor", () => {
  test("round-trips each actor kind", () => {
    expect(decodeActor({ kind: "user" })).toEqual({ kind: "user" })
    expect(decodeActor({ kind: "agent", chatId: "c1" })).toEqual({ kind: "agent", chatId: "c1" })
    expect(decodeActor({ kind: "sync", providerId: "github-issues" })).toEqual({
      kind: "sync",
      providerId: "github-issues",
    })
  })

  test("falls back to user for anything unreadable", () => {
    // Conservative on purpose: an unreadable actor must never be treated as an
    // agent, because agent-origin writes are the ones held back from a push.
    expect(decodeActor({ kind: "agent" })).toEqual({ kind: "user" })
    expect(decodeActor({ kind: "sync", providerId: 5 })).toEqual({ kind: "user" })
    expect(decodeActor(null)).toEqual({ kind: "user" })
    expect(decodeActor("agent")).toEqual({ kind: "user" })
  })
})

describe("decodeFieldDef", () => {
  test("decodes a full definition", () => {
    expect(
      decodeFieldDef({
        id: "priority",
        label: "Priority",
        kind: "select",
        required: true,
        options: [{ id: "high", label: "High", colorToken: "warning" }],
      }),
    ).toEqual({
      id: "priority",
      label: "Priority",
      kind: "select",
      required: true,
      options: [{ id: "high", label: "High", colorToken: "warning" }],
    })
  })

  test("nulls a colour token that is not in the closed set", () => {
    // An open colour set is exactly what the design rules out, so an
    // unrecognised token degrades to "no dot" rather than leaking through.
    const decoded = decodeFieldDef({
      id: "f",
      label: "F",
      kind: "select",
      options: [{ id: "o", label: "O", colorToken: "hotpink" }],
    })
    expect(decoded?.options).toEqual([{ id: "o", label: "O", colorToken: null }])
  })

  test("treats a missing required flag as not required", () => {
    expect(decodeFieldDef({ id: "f", label: "F", kind: "text" })?.required).toBe(false)
  })

  test("rejects a missing id, label, or unknown kind", () => {
    expect(decodeFieldDef({ label: "F", kind: "text" })).toBeNull()
    expect(decodeFieldDef({ id: "f", kind: "text" })).toBeNull()
    expect(decodeFieldDef({ id: "f", label: "F", kind: "rich-text" })).toBeNull()
  })

  test("decodeFieldDefs drops the unreadable entries", () => {
    expect(
      decodeFieldDefs([
        { id: "a", label: "A", kind: "text" },
        { id: "b", kind: "text" },
        "nonsense",
      ]),
    ).toEqual([{ id: "a", label: "A", kind: "text", options: null, required: false }])
    expect(decodeFieldDefs(null)).toEqual([])
  })
})

describe("decodeTemplate", () => {
  test("decodes a column and nulls unrecognised semantics and colours", () => {
    expect(
      decodeTemplateColumn({ title: "Todo", semantic: "start", colorToken: "info", wipLimit: 3 }),
    ).toEqual({ title: "Todo", semantic: "start", colorToken: "info", wipLimit: 3 })

    expect(decodeTemplateColumn({ title: "Todo", semantic: "shipped", colorToken: "neon" })).toEqual({
      title: "Todo",
      semantic: null,
      colorToken: null,
      wipLimit: null,
    })
  })

  test("rejects a column with no title", () => {
    expect(decodeTemplateColumn({ semantic: "start" })).toBeNull()
  })

  test("decodes a mapping and rejects an unknown remote kind", () => {
    expect(decodeTemplateMapping({ columnTitle: "Done", remoteKind: "state", remoteValue: "closed" })).toEqual({
      columnTitle: "Done",
      remoteKind: "state",
      remoteValue: "closed",
    })
    expect(
      decodeTemplateMapping({ columnTitle: "Done", remoteKind: "telepathy", remoteValue: "closed" }),
    ).toBeNull()
  })

  test("a definition survives partial corruption", () => {
    const decoded = decodeTemplateDefinition({
      columns: [{ title: "Todo" }, { semantic: "done" }],
      cardFields: [{ id: "a", label: "A", kind: "text" }, 42],
      mappingDefaults: [{ columnTitle: "Todo", remoteKind: "label", remoteValue: "todo" }, null],
    })
    expect(decoded.columns).toHaveLength(1)
    expect(decoded.cardFields).toHaveLength(1)
    expect(decoded.mappingDefaults).toHaveLength(1)
  })

  test("returns an empty definition for anything unusable", () => {
    expect(decodeTemplateDefinition(null)).toEqual({ columns: [], cardFields: [], mappingDefaults: [] })
    expect(decodeTemplateDefinition("{}")).toEqual({ columns: [], cardFields: [], mappingDefaults: [] })
  })
})
