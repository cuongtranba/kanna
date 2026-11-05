import { expect, test } from "vite-plus/test"
import { decideProposal, type ProposalDecisionInput } from "./inbox-autonomy"

const PASSING: ProposalDecisionInput = {
  level: "auto",
  providerAllowsAuto: true,
  paused: false,
  allowlisted: true,
  confidence: 0.9,
  threshold: 0.8,
  sentLastHourThread: 0,
  perThreadPerHour: 3,
  sentTodaySource: 0,
  perSourcePerDay: 20,
  inQuietHours: false,
  textViolations: [],
}

function decide(overrides: Partial<ProposalDecisionInput>) {
  return decideProposal({ ...PASSING, ...overrides })
}

test("off and suggest keep the proposal as a draft", () => {
  expect(decide({ level: "off" })).toEqual({ kind: "draft" })
  expect(decide({ level: "suggest" })).toEqual({ kind: "draft" })
})

test("approve always asks the user, without a block reason", () => {
  expect(decide({ level: "approve", allowlisted: false })).toEqual({ kind: "approval" })
})

test("auto sends when every guardrail passes", () => {
  expect(decide({})).toEqual({ kind: "auto" })
})

test("each guardrail turns auto into an approval card that names it", () => {
  const blocked = (overrides: Partial<ProposalDecisionInput>): string => {
    const decision = decide(overrides)
    if (decision.kind !== "approval" || decision.blockedBy === undefined) throw new Error("expected a blocked approval")
    return decision.blockedBy
  }
  expect(blocked({ providerAllowsAuto: false })).toMatch(/not available/)
  expect(blocked({ allowlisted: false })).toMatch(/allowlist/)
  expect(blocked({ confidence: 0.5 })).toMatch(/Confidence 50% is below the 80% threshold/)
  expect(blocked({ sentLastHourThread: 3 })).toMatch(/Hourly limit of 3/)
  expect(blocked({ sentTodaySource: 20 })).toMatch(/Daily limit of 20/)
  expect(blocked({ inQuietHours: true })).toMatch(/Quiet hours/)
  expect(blocked({ textViolations: ["contains a URL"] })).toMatch(/contains a URL/)
})

test("when several guardrails fail, the first in the fixed order is named", () => {
  const decision = decide({ allowlisted: false, confidence: 0.1, inQuietHours: true, textViolations: ["contains HTML"] })
  expect(decision).toMatchObject({ kind: "approval", blockedBy: expect.stringMatching(/allowlist/) })
  const afterAllowlist = decide({ confidence: 0.1, sentLastHourThread: 9, inQuietHours: true })
  expect(afterAllowlist).toMatchObject({ kind: "approval", blockedBy: expect.stringMatching(/Confidence/) })
})

test("a paused agent only ever drafts, whatever the level", () => {
  expect(decide({ paused: true })).toEqual({ kind: "draft" })
  expect(decide({ paused: true, level: "approve" })).toEqual({ kind: "draft" })
})
