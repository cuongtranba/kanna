import { describe, expect, test } from "bun:test"
import { LOAD_BEARING_FIELD_NOTES, loadBearingFieldNote } from "./cardSchema"
import { buildStartWorkPrompt } from "./start-work"
import type { Card, CardContent, FieldValue } from "./types"

function cardWith(content: CardContent): Card {
  return {
    id: "card-1",
    boardId: "board-1",
    columnId: "col-1",
    projectId: "proj-1",
    title: "Fix the thing",
    rank: "a0",
    content,
    updatedBy: { kind: "user" },
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
  }
}

describe("loadBearingFieldNote", () => {
  test("names a field the rest of Kanna reads, and nothing else", () => {
    expect(loadBearingFieldNote("description")).toContain("GitHub")
    expect(loadBearingFieldNote("labels")).not.toBeNull()
    expect(loadBearingFieldNote("assignee")).not.toBeNull()
    expect(loadBearingFieldNote("externalUrl")).not.toBeNull()
    expect(loadBearingFieldNote("acceptanceCriteria")).not.toBeNull()
    expect(loadBearingFieldNote("priority")).toBeNull()
    expect(loadBearingFieldNote("")).toBeNull()
  })

  test("covers every id the start-work prompt reads by name", () => {
    const probes: Readonly<Record<string, FieldValue>> = {
      description: { kind: "longtext", value: "PROBE_DESCRIPTION" },
      acceptanceCriteria: { kind: "text", value: "PROBE_ACCEPTANCE" },
      labels: { kind: "label", values: ["PROBE_LABEL"] },
      externalUrl: { kind: "url", value: "PROBE_URL" },
    }

    for (const [fieldId, value] of Object.entries(probes)) {
      const prompt = buildStartWorkPrompt(cardWith({ [fieldId]: value }), "card/1-fix", null)
      const bare = buildStartWorkPrompt(cardWith({}), "card/1-fix", null)
      expect(prompt).not.toEqual(bare)
      expect(loadBearingFieldNote(fieldId)).not.toBeNull()
    }
  })

  test("every note says what stops working", () => {
    for (const note of Object.values(LOAD_BEARING_FIELD_NOTES)) {
      expect(note.length).toBeGreaterThan(0)
      expect(/sync|Start work/i.test(note)).toBe(true)
    }
  })
})
