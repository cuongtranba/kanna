import { describe, expect, test } from "bun:test"
import { markdownDoc } from "./structured-doc/markdown"
import { TASK_DOC_SECTIONS, renderTaskDocSkeleton } from "./task-doc"

describe("renderTaskDocSkeleton", () => {
  const skeleton = renderTaskDocSkeleton()

  test("every declared section is a section the markdown engine can find", () => {
    const headings = markdownDoc.sections(skeleton).map((section) => section.heading)
    for (const section of Object.values(TASK_DOC_SECTIONS)) {
      expect(headings).toContain(section)
    }
  })

  test("the engine can append and replace against the seeded document", () => {
    const appended = markdownDoc.append(skeleton, {
      section: TASK_DOC_SECTIONS.completed,
      entry: "- located the refresh implementation",
    })
    expect(appended.created).toBe(false)
    expect(appended.content).toContain("located the refresh implementation")

    const replaced = markdownDoc.replace(appended.content, {
      section: TASK_DOC_SECTIONS.status,
      body: "in_progress — implementation",
    })
    expect(replaced.created).toBe(false)
    expect(markdownDoc.query(replaced.content, { sections: [TASK_DOC_SECTIONS.status] }).content)
      .toContain("in_progress — implementation")
  })

  test("it declares no Goal section, so a later setup_loop is not refused", () => {
    const headings = markdownDoc.sections(skeleton).map((section) => section.heading.toLowerCase())
    expect(headings).not.toContain("goal")
    expect(headings).toContain(TASK_DOC_SECTIONS.objective.toLowerCase())
  })

  test("its failed-approaches section is the one the loop already uses", () => {
    expect(TASK_DOC_SECTIONS.failedApproaches).toBe("Failed approaches")
  })
})
