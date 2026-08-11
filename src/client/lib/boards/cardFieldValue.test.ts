import { describe, expect, test } from "bun:test"
import {
  fieldDisplayText,
  fieldDraftText,
  nextCardContent,
  optionsOf,
  parseFieldDraft,
  selectedOptionId,
  selectedOptionIds,
  toggledOptionIds,
} from "./cardFieldValue"
import type { CardContent, FieldDef } from "../../../shared/boards/types"

const TEXT: FieldDef = { id: "assignee", label: "Assignee", kind: "text", options: null, required: false }
const LONGTEXT: FieldDef = { id: "description", label: "Description", kind: "longtext", options: null, required: false }
const URL: FieldDef = { id: "externalUrl", label: "Source", kind: "url", options: null, required: false }
const NUMBER: FieldDef = { id: "estimate", label: "Estimate", kind: "number", options: null, required: false }
const DATE: FieldDef = { id: "due", label: "Due", kind: "date", options: null, required: false }
const LABEL: FieldDef = { id: "labels", label: "Labels", kind: "label", options: null, required: false }
const SELECT: FieldDef = {
  id: "priority",
  label: "Priority",
  kind: "select",
  required: false,
  options: [
    { id: "high", label: "High", colorToken: "destructive" },
    { id: "low", label: "Low", colorToken: "muted-icon" },
  ],
}
const MULTI: FieldDef = {
  id: "areas",
  label: "Areas",
  kind: "multiselect",
  required: false,
  options: [
    { id: "ui", label: "UI", colorToken: null },
    { id: "api", label: "API", colorToken: null },
  ],
}

describe("fieldDraftText", () => {
  test("gives every kind the text it is edited as", () => {
    expect(fieldDraftText(TEXT, { kind: "text", value: "Ada" })).toBe("Ada")
    expect(fieldDraftText(NUMBER, { kind: "number", value: 3 })).toBe("3")
    expect(fieldDraftText(DATE, { kind: "date", value: Date.UTC(2026, 2, 1) })).toBe("2026-03-01")
    expect(fieldDraftText(LABEL, { kind: "label", values: ["bug", "ui"] })).toBe("bug, ui")
    expect(fieldDraftText(SELECT, { kind: "select", optionId: "high" })).toBe("high")
  })

  test("an unset field edits as an empty draft", () => {
    expect(fieldDraftText(TEXT, undefined)).toBe("")
    expect(fieldDraftText(DATE, undefined)).toBe("")
  })

  /** Content can outlive a schema change; a mismatched value must not throw. */
  test("a value of the wrong kind reads as unset rather than crashing", () => {
    expect(fieldDraftText(NUMBER, { kind: "text", value: "3" })).toBe("")
  })
})

describe("parseFieldDraft", () => {
  test("reads back what fieldDraftText wrote", () => {
    expect(parseFieldDraft(TEXT, "Ada")).toEqual({ kind: "text", value: "Ada" })
    expect(parseFieldDraft(LONGTEXT, "  body  ")).toEqual({ kind: "longtext", value: "body" })
    expect(parseFieldDraft(URL, "https://example.com")).toEqual({ kind: "url", value: "https://example.com" })
    expect(parseFieldDraft(NUMBER, "3")).toEqual({ kind: "number", value: 3 })
    expect(parseFieldDraft(DATE, "2026-03-01")).toEqual({ kind: "date", value: Date.UTC(2026, 2, 1) })
    expect(parseFieldDraft(LABEL, "bug, ui")).toEqual({ kind: "label", values: ["bug", "ui"] })
    expect(parseFieldDraft(SELECT, "high")).toEqual({ kind: "select", optionId: "high" })
  })

  /** Emptying a field clears it, rather than storing an empty string forever. */
  test("an empty draft clears the field", () => {
    expect(parseFieldDraft(TEXT, "   ")).toBeNull()
    expect(parseFieldDraft(NUMBER, "")).toBeNull()
    expect(parseFieldDraft(DATE, "")).toBeNull()
    expect(parseFieldDraft(LABEL, " , ")).toBeNull()
    expect(parseFieldDraft(SELECT, "")).toBeNull()
  })

  test("refuses a draft the kind cannot mean", () => {
    expect(parseFieldDraft(NUMBER, "soon")).toBeNull()
    expect(parseFieldDraft(DATE, "next tuesday")).toBeNull()
  })

  /** The server rejects an unknown option, so offering one here would only be a round-trip to an error. */
  test("refuses an option the field does not offer", () => {
    expect(parseFieldDraft(SELECT, "urgent")).toBeNull()
    expect(parseFieldDraft(MULTI, "ui, database")).toEqual({ kind: "multiselect", optionIds: ["ui"] })
  })
})

describe("fieldDisplayText", () => {
  /** An id is storage; a reader is owed the label the board gave it. */
  test("a chosen option reads as its label, never its id", () => {
    expect(fieldDisplayText(SELECT, { kind: "select", optionId: "high" })).toBe("High")
    expect(fieldDisplayText(MULTI, { kind: "multiselect", optionIds: ["api", "ui"] })).toBe("API, UI")
  })

  test("an option the schema has since dropped reads as nothing", () => {
    expect(fieldDisplayText(SELECT, { kind: "select", optionId: "gone" })).toBe("")
  })

  test("everything else reads as its draft text", () => {
    expect(fieldDisplayText(NUMBER, { kind: "number", value: 12 })).toBe("12")
    expect(fieldDisplayText(LABEL, { kind: "label", values: ["bug"] })).toBe("bug")
    expect(fieldDisplayText(TEXT, undefined)).toBe("")
  })
})

describe("nextCardContent", () => {
  const CONTENT: CardContent = {
    description: { kind: "longtext", value: "body" },
    assignee: { kind: "text", value: "Ada" },
  }

  /**
   * The store REPLACES a card's content rather than merging it, so every commit
   * has to carry the fields it did not touch or they are erased.
   */
  test("carries the fields the edit did not touch", () => {
    expect(nextCardContent(CONTENT, "assignee", { kind: "text", value: "Grace" })).toEqual({
      description: { kind: "longtext", value: "body" },
      assignee: { kind: "text", value: "Grace" },
    })
  })

  test("a null value removes the field rather than storing an empty one", () => {
    expect(nextCardContent(CONTENT, "assignee", null)).toEqual({
      description: { kind: "longtext", value: "body" },
    })
  })

  test("does not mutate what it was given", () => {
    nextCardContent(CONTENT, "assignee", null)
    expect(CONTENT.assignee).toEqual({ kind: "text", value: "Ada" })
  })
})

describe("option helpers", () => {
  test("reads the current selection, and nothing from a mismatched value", () => {
    expect(selectedOptionId({ kind: "select", optionId: "high" })).toBe("high")
    expect(selectedOptionId({ kind: "text", value: "high" })).toBeNull()
    expect(selectedOptionIds({ kind: "multiselect", optionIds: ["ui"] })).toEqual(["ui"])
    expect(selectedOptionIds(undefined)).toEqual([])
  })

  test("toggling adds an unheld option and removes a held one", () => {
    expect(toggledOptionIds({ kind: "multiselect", optionIds: ["ui"] }, "api")).toEqual(["ui", "api"])
    expect(toggledOptionIds({ kind: "multiselect", optionIds: ["ui", "api"] }, "ui")).toEqual(["api"])
  })

  test("options are a list even when a field declares none", () => {
    expect(optionsOf(TEXT)).toEqual([])
    expect(optionsOf(SELECT)).toHaveLength(2)
  })
})
