import { describe, expect, test } from "bun:test"
import {
  addField,
  addOption,
  mintFieldId,
  missingLoadBearingIds,
  moveField,
  removeField,
  removeOption,
  renameField,
  renameOption,
  setOptionColor,
  slugFieldId,
  toggleRequired,
} from "./cardSchemaDraft"
import type { FieldDef } from "../../../shared/boards/types"

const FIELDS: readonly FieldDef[] = [
  { id: "description", label: "Description", kind: "longtext", options: null, required: false },
  {
    id: "priority",
    label: "Priority",
    kind: "select",
    required: false,
    options: [
      { id: "high", label: "High", colorToken: "warning" },
      { id: "low", label: "Low", colorToken: "muted-icon" },
    ],
  },
  { id: "labels", label: "Labels", kind: "label", options: null, required: false },
]

describe("slugFieldId", () => {
  test("camel-cases a label so the obvious name lands on the id the rest of Kanna reads", () => {
    expect(slugFieldId("Description")).toBe("description")
    expect(slugFieldId("Acceptance criteria")).toBe("acceptanceCriteria")
    expect(slugFieldId("  Story   points ")).toBe("storyPoints")
    expect(slugFieldId("Time-to-first-byte")).toBe("timeToFirstByte")
  })

  test("never yields an empty id", () => {
    expect(slugFieldId("")).toBe("field")
    expect(slugFieldId("!!!")).toBe("field")
  })
})

describe("mintFieldId", () => {
  test("de-duplicates against the ids already on the board", () => {
    expect(mintFieldId("Priority", FIELDS)).toBe("priority2")
    expect(mintFieldId("Estimate", FIELDS)).toBe("estimate")
  })

  test("keeps counting past the first collision", () => {
    const taken: FieldDef[] = [
      { id: "note", label: "Note", kind: "text", options: null, required: false },
      { id: "note2", label: "Note", kind: "text", options: null, required: false },
    ]
    expect(mintFieldId("Note", taken)).toBe("note3")
  })
})

/**
 * The invariant the whole editor rests on. `CardContent` is keyed by field id,
 * so an id that moves takes every card's value for that field with it.
 */
describe("a field id is immutable once created", () => {
  test("renaming changes the label and nothing else", () => {
    const renamed = renameField(FIELDS, "description", "Summary")
    expect(renamed[0]).toEqual({
      id: "description",
      label: "Summary",
      kind: "longtext",
      options: null,
      required: false,
    })
  })

  test("no edit rewrites an id", () => {
    const before = FIELDS.map((field) => field.id)
    const edited = [
      (fields: readonly FieldDef[]) => renameField(fields, "priority", "Urgency"),
      (fields: readonly FieldDef[]) => toggleRequired(fields, "description"),
      (fields: readonly FieldDef[]) => moveField(fields, "labels", -1),
      (fields: readonly FieldDef[]) => addOption(fields, "priority", "Medium"),
      (fields: readonly FieldDef[]) => renameOption(fields, "priority", "high", "Highest"),
      (fields: readonly FieldDef[]) => setOptionColor(fields, "priority", "low", "info"),
    ].reduce<readonly FieldDef[]>((fields, edit) => edit(fields), FIELDS)

    expect([...edited].map((field) => field.id).sort()).toEqual([...before].sort())
    expect(edited.find((field) => field.id === "priority")?.options?.map((option) => option.id)).toEqual([
      "high",
      "low",
      "medium",
    ])
  })

  test("re-adding a removed field with the same label mints the same id, so its values come back", () => {
    const without = removeField(FIELDS, "description")
    expect(without.map((field) => field.id)).toEqual(["priority", "labels"])
    expect(mintFieldId("Description", without)).toBe("description")
  })
})

describe("addField", () => {
  test("gives an option kind an empty list and every other kind none", () => {
    const withSelect = addField(FIELDS, "Severity", "select")
    expect(withSelect.at(-1)).toEqual({
      id: "severity",
      label: "Severity",
      kind: "select",
      options: [],
      required: false,
    })
    expect(addField(FIELDS, "Owner", "text").at(-1)?.options).toBeNull()
  })

  test("appends, because array order is render order in the drawer", () => {
    expect(addField(FIELDS, "Owner", "text").map((field) => field.id)).toEqual([
      "description",
      "priority",
      "labels",
      "owner",
    ])
  })

  test("trims the label and refuses a blank one", () => {
    expect(addField(FIELDS, "  Owner  ", "text").at(-1)?.label).toBe("Owner")
    expect(addField(FIELDS, "   ", "text")).toEqual(FIELDS)
  })
})

describe("moveField", () => {
  test("swaps with its neighbour", () => {
    expect(moveField(FIELDS, "priority", -1).map((field) => field.id)).toEqual([
      "priority",
      "description",
      "labels",
    ])
    expect(moveField(FIELDS, "priority", 1).map((field) => field.id)).toEqual([
      "description",
      "labels",
      "priority",
    ])
  })

  test("stays put at either end rather than wrapping", () => {
    expect(moveField(FIELDS, "description", -1)).toEqual(FIELDS)
    expect(moveField(FIELDS, "labels", 1)).toEqual(FIELDS)
    expect(moveField(FIELDS, "missing", 1)).toEqual(FIELDS)
  })
})

describe("options", () => {
  test("an option id is minted once and de-duplicated within its field", () => {
    const added = addOption(addField(FIELDS, "Severity", "select"), "severity", "High")
    expect(added.at(-1)?.options).toEqual([{ id: "high", label: "High", colorToken: null }])

    const twice = addOption(added, "severity", "High")
    expect(twice.at(-1)?.options?.map((option) => option.id)).toEqual(["high", "high2"])
  })

  test("renaming an option keeps its id", () => {
    const renamed = renameOption(FIELDS, "priority", "high", "Critical")
    expect(renamed[1]?.options?.[0]).toEqual({ id: "high", label: "Critical", colorToken: "warning" })
  })

  test("a colour outside the board palette clears the dot instead of storing itself", () => {
    expect(setOptionColor(FIELDS, "priority", "high", "chartreuse")[1]?.options?.[0]?.colorToken).toBeNull()
    expect(setOptionColor(FIELDS, "priority", "high", "success")[1]?.options?.[0]?.colorToken).toBe("success")
  })

  test("removing an option leaves the other options alone", () => {
    expect(removeOption(FIELDS, "priority", "high")[1]?.options).toEqual([
      { id: "low", label: "Low", colorToken: "muted-icon" },
    ])
  })

  test("a field with no option list is untouched by option edits", () => {
    expect(addOption(FIELDS, "description", "Nope")).toEqual(FIELDS)
    expect(removeOption(FIELDS, "labels", "anything")).toEqual(FIELDS)
  })
})

describe("toggleRequired", () => {
  test("flips one field", () => {
    expect(toggleRequired(FIELDS, "labels")[2]?.required).toBe(true)
    expect(toggleRequired(toggleRequired(FIELDS, "labels"), "labels")).toEqual(FIELDS)
  })
})

describe("missingLoadBearingIds", () => {
  test("names the ids other features read that this board has not declared", () => {
    expect(missingLoadBearingIds(FIELDS)).toEqual(["assignee", "acceptanceCriteria", "externalUrl"])
  })

  test("a board declaring them all has nothing to warn about", () => {
    const complete: FieldDef[] = ["description", "labels", "assignee", "acceptanceCriteria", "externalUrl"].map(
      (id) => ({ id, label: id, kind: "text", options: null, required: false }),
    )
    expect(missingLoadBearingIds(complete)).toEqual([])
  })
})
