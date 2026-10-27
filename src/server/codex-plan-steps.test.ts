import { describe, expect, test } from "vite-plus/test"
import { parsePlanSteps } from "./codex-plan-steps"

describe("parsePlanSteps", () => {
  test("parses camelCase and snake_case status", () => {
    const result = parsePlanSteps({
      explanation: "phase one",
      plan: [
        { step: "lint", status: "completed" },
        { step: "test", status: "in_progress" },
        { step: "ship", status: "inProgress" },
        { step: "deploy", status: "pending" },
      ],
    })
    expect(result).toEqual({
      explanation: "phase one",
      steps: [
        { step: "lint", status: "completed" },
        { step: "test", status: "inProgress" },
        { step: "ship", status: "inProgress" },
        { step: "deploy", status: "pending" },
      ],
    })
  })

  test("drops steps with an empty or non-string name, live and replayed alike", () => {
    const result = parsePlanSteps({
      plan: [{ step: "", status: "pending" }, { step: 4, status: "pending" }, { step: "keep", status: "pending" }],
    })
    expect(result).toEqual({ explanation: null, steps: [{ step: "keep", status: "pending" }] })
  })

  test("returns null when there is no plan or no usable step", () => {
    expect(parsePlanSteps({})).toBeNull()
    expect(parsePlanSteps({ plan: [{ step: "", status: "pending" }] })).toBeNull()
  })
})
