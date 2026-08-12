import { describe, expect, test } from "bun:test"
import type { CardContent, FieldDef, FieldValue } from "./types"
import {
  decodeActor,
  decodeCardContent,
  decodeContentForFields,
  decodeFieldDef,
  decodeFieldDefs,
  decodeFieldDefsForWrite,
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

// ── Strict, schema-aware decode ───────────────────────────────────────────────

const FIELDS: FieldDef[] = [
  { id: "description", label: "Description", kind: "longtext", options: null, required: false },
  { id: "estimate", label: "Estimate", kind: "number", options: null, required: false },
  { id: "due", label: "Due", kind: "date", options: null, required: false },
  { id: "source", label: "Source", kind: "url", options: null, required: false },
  {
    id: "priority",
    label: "Priority",
    kind: "select",
    required: true,
    options: [
      { id: "high", label: "High", colorToken: "destructive" },
      { id: "low", label: "Low", colorToken: "muted-icon" },
    ],
  },
  {
    id: "areas",
    label: "Areas",
    kind: "multiselect",
    required: false,
    options: [
      { id: "ui", label: "UI", colorToken: null },
      { id: "api", label: "API", colorToken: null },
    ],
  },
  { id: "labels", label: "Labels", kind: "label", options: null, required: false },
]

describe("decodeContentForFields", () => {
  test("accepts a value of every kind the schema declares", () => {
    const content: CardContent = {
      description: { kind: "longtext", value: "body" },
      estimate: { kind: "number", value: 3 },
      due: { kind: "date", value: 1_700_000_000_000 },
      source: { kind: "url", value: "https://example.com" },
      priority: { kind: "select", optionId: "high" },
      areas: { kind: "multiselect", optionIds: ["ui", "api"] },
      labels: { kind: "label", values: ["bug"] },
    }
    expect(decodeContentForFields(FIELDS, JSON.parse(JSON.stringify(content)))).toEqual(content)
  })

  test("an empty patch is a patch, not a failure", () => {
    expect(decodeContentForFields(FIELDS, {})).toEqual({})
  })

  /**
   * The lenient storage decoder drops what it cannot read so one bad row stays
   * readable. A write must do the opposite: dropping a field here would ack a
   * change that never landed.
   */
  test("rejects, rather than drops, a field the schema does not declare", () => {
    expect(decodeContentForFields(FIELDS, { nope: { kind: "text", value: "x" } })).toBeNull()
  })

  test("rejects a value whose kind disagrees with its definition", () => {
    expect(decodeContentForFields(FIELDS, { estimate: { kind: "text", value: "3" } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { description: { kind: "text", value: "body" } })).toBeNull()
  })

  test("rejects a structurally wrong payload", () => {
    expect(decodeContentForFields(FIELDS, { estimate: { kind: "number", value: "3" } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { due: { kind: "date", value: 1.5 } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { due: { kind: "date", value: "yesterday" } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { labels: { kind: "label", values: "bug" } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { labels: { kind: "label", values: ["bug", 7] } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { description: {} })).toBeNull()
    expect(decodeContentForFields(FIELDS, { description: null })).toBeNull()
  })

  test("rejects an option the field does not offer", () => {
    expect(decodeContentForFields(FIELDS, { priority: { kind: "select", optionId: "urgent" } })).toBeNull()
    expect(decodeContentForFields(FIELDS, { areas: { kind: "multiselect", optionIds: ["ui", "db"] } })).toBeNull()
  })

  test("a cleared select is a value, not a rejection", () => {
    expect(decodeContentForFields(FIELDS, { priority: { kind: "select", optionId: null } })).toEqual({
      priority: { kind: "select", optionId: null },
    })
  })

  /**
   * A patch names one field at a time, so completeness cannot be judged here —
   * and `required` is advisory anyway: it marks a field, it never refuses a save.
   */
  test("says nothing about a required field the patch omits", () => {
    expect(decodeContentForFields(FIELDS, { labels: { kind: "label", values: [] } })).toEqual({
      labels: { kind: "label", values: [] },
    })
  })

  test("rejects anything that is not an object", () => {
    expect(decodeContentForFields(FIELDS, null)).toBeNull()
    expect(decodeContentForFields(FIELDS, "{}")).toBeNull()
    expect(decodeContentForFields(FIELDS, [])).toBeNull()
  })

  test("a board with no schema accepts no content", () => {
    expect(decodeContentForFields([], { labels: { kind: "label", values: [] } })).toBeNull()
    expect(decodeContentForFields([], {})).toEqual({})
  })
})

/**
 * `board.update` is the only path by which a board's schema is ever written, so
 * what it refuses is the whole guarantee: the store writes `cardFields` whole
 * and checks nothing.
 */
describe("decodeFieldDefsForWrite", () => {
  const FIELD = { id: "priority", label: "Priority", kind: "select", required: false, options: [] }

  test("accepts a schema and returns it whole", () => {
    expect(
      decodeFieldDefsForWrite([
        { id: "description", label: "Description", kind: "longtext", options: null, required: false },
        { ...FIELD, options: [{ id: "high", label: "High", colorToken: "warning" }] },
      ]),
    ).toEqual([
      { id: "description", label: "Description", kind: "longtext", options: null, required: false },
      {
        id: "priority",
        label: "Priority",
        kind: "select",
        required: false,
        options: [{ id: "high", label: "High", colorToken: "warning" }],
      },
    ])
  })

  test("an empty schema is a schema — it is what a title-only board has", () => {
    expect(decodeFieldDefsForWrite([])).toEqual([])
  })

  /** Content is keyed by field id, so two fields sharing one fight over a value. */
  test("rejects a duplicate field id", () => {
    expect(
      decodeFieldDefsForWrite([
        { id: "notes", label: "Notes", kind: "text", options: null, required: false },
        { id: "notes", label: "Other notes", kind: "text", options: null, required: false },
      ]),
    ).toBeNull()
  })

  test("rejects a duplicate option id within one field", () => {
    expect(
      decodeFieldDefsForWrite([
        {
          ...FIELD,
          options: [
            { id: "high", label: "High", colorToken: null },
            { id: "high", label: "Higher", colorToken: null },
          ],
        },
      ]),
    ).toBeNull()
  })

  test("the same option id on two different fields is fine", () => {
    expect(
      decodeFieldDefsForWrite([
        { ...FIELD, options: [{ id: "high", label: "High", colorToken: null }] },
        {
          id: "severity",
          label: "Severity",
          kind: "select",
          required: false,
          options: [{ id: "high", label: "High", colorToken: null }],
        },
      ]),
    ).toHaveLength(2)
  })

  test("rejects an unknown kind", () => {
    expect(
      decodeFieldDefsForWrite([{ id: "n", label: "N", kind: "currency", options: null, required: false }]),
    ).toBeNull()
  })

  /** An open colour set would put a value in the database correct in one theme. */
  test("rejects an option colour outside the board palette", () => {
    expect(
      decodeFieldDefsForWrite([{ ...FIELD, options: [{ id: "high", label: "High", colorToken: "chartreuse" }] }]),
    ).toBeNull()
    expect(
      decodeFieldDefsForWrite([{ ...FIELD, options: [{ id: "high", label: "High", colorToken: null }] }]),
    ).toHaveLength(1)
  })

  test("rejects a blank id or label rather than storing a field nothing can name", () => {
    expect(decodeFieldDefsForWrite([{ ...FIELD, id: "" }])).toBeNull()
    expect(decodeFieldDefsForWrite([{ ...FIELD, label: "  " }])).toBeNull()
    expect(decodeFieldDefsForWrite([{ ...FIELD, options: [{ id: "", label: "High", colorToken: null }] }])).toBeNull()
  })

  test("insists an option kind carries a list, and every other kind carries none", () => {
    expect(decodeFieldDefsForWrite([{ ...FIELD, options: null }])).toBeNull()
    expect(
      decodeFieldDefsForWrite([{ id: "n", label: "N", kind: "text", options: [], required: false }]),
    ).toBeNull()
  })

  test("rejects a required flag that is not a boolean", () => {
    expect(decodeFieldDefsForWrite([{ ...FIELD, required: "yes" }])).toBeNull()
  })

  test("rejects anything that is not an array of records", () => {
    expect(decodeFieldDefsForWrite(null)).toBeNull()
    expect(decodeFieldDefsForWrite({})).toBeNull()
    expect(decodeFieldDefsForWrite(["priority"])).toBeNull()
  })

  /**
   * The half of the contract the lenient decoder answers the other way: storage
   * drops what it cannot read so the rest of the row survives, a write refuses
   * so the sender learns its change did not land.
   */
  test("refuses where decodeFieldDefs would drop", () => {
    const ragged = [{ id: "ok", label: "Ok", kind: "text", options: null, required: false }, { id: 7 }]
    expect(decodeFieldDefs(ragged)).toHaveLength(1)
    expect(decodeFieldDefsForWrite(ragged)).toBeNull()
  })
})
