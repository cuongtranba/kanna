import { expect, test } from "bun:test"
import { cronModeConsequence, formatCronArmSummary } from "./arm-summary"
import type { CronArmSummary } from "./types"

const FIRES_MS = [1_700_000_000_000, 1_700_086_400_000, 1_700_172_800_000] as const

const INLINE_SUMMARY: CronArmSummary = {
  jobId: null,
  instruction: "check ci",
  mode: "inline",
  modeConsequence: cronModeConsequence("inline"),
  scheduleText: "0 9 * * *",
  scheduleHuman: "daily at 09:00",
  upcomingFires: FIRES_MS,
  model: null,
  cwd: null,
}

const SPAWN_SUMMARY: CronArmSummary = {
  jobId: null,
  instruction: "build report",
  mode: "spawn",
  modeConsequence: cronModeConsequence("spawn"),
  scheduleText: "@daily",
  scheduleHuman: "daily at 00:00",
  upcomingFires: [FIRES_MS[0], FIRES_MS[1]],
  model: null,
  cwd: null,
}

test("cronModeConsequence inline — the canonical sentence used in preview prose", () => {
  expect(cronModeConsequence("inline")).toBe("runs in this chat, context cleared each cycle")
})

test("cronModeConsequence spawn — the canonical sentence used in preview prose", () => {
  expect(cronModeConsequence("spawn")).toBe("a new chat per run")
})

test("formatCronArmSummary inline — byte-identical to old preview.ts prose", () => {
  const fires = INLINE_SUMMARY.upcomingFires
  const expected = [
    `VALID — ${INLINE_SUMMARY.scheduleHuman}`,
    `instruction: ${INLINE_SUMMARY.instruction}`,
    `mode: inline (runs in this chat, context cleared each cycle)`,
    `next ${String(fires.length)} runs: ${fires.map((at) => new Date(at).toISOString()).join(", ")}`,
  ].join("\n")
  expect(formatCronArmSummary(INLINE_SUMMARY)).toBe(expected)
})

test("formatCronArmSummary spawn — byte-identical to old preview.ts prose", () => {
  const fires = SPAWN_SUMMARY.upcomingFires
  const expected = [
    `VALID — ${SPAWN_SUMMARY.scheduleHuman}`,
    `instruction: ${SPAWN_SUMMARY.instruction}`,
    `mode: spawn (a new chat per run)`,
    `next ${String(fires.length)} runs: ${fires.map((at) => new Date(at).toISOString()).join(", ")}`,
  ].join("\n")
  expect(formatCronArmSummary(SPAWN_SUMMARY)).toBe(expected)
})
