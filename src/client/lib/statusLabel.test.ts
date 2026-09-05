import { describe, expect, test } from "bun:test"
import {
  statusLabel,
  statusTone,
  statusToneClass,
  workflowStatusLabel,
  workflowStatusTone,
} from "./statusLabel"

describe("statusLabel", () => {
  test("idle → Idle", () => expect(statusLabel("idle")).toBe("Idle"))
  test("starting → Starting", () => expect(statusLabel("starting")).toBe("Starting"))
  test("running → Running", () => expect(statusLabel("running")).toBe("Running"))
  test("waiting_for_user → Waiting", () => expect(statusLabel("waiting_for_user")).toBe("Waiting"))
  test("failed → Failed", () => expect(statusLabel("failed")).toBe("Failed"))
})

describe("statusTone", () => {
  test("idle → muted", () => expect(statusTone("idle")).toBe("muted"))
  test("starting → muted", () => expect(statusTone("starting")).toBe("muted"))
  test("running → active", () => expect(statusTone("running")).toBe("active"))
  test("waiting_for_user → attention", () => expect(statusTone("waiting_for_user")).toBe("attention"))
  test("failed → destructive", () => expect(statusTone("failed")).toBe("destructive"))
})

const ALL_TONES = ["muted", "active", "attention", "destructive"] as const

describe("statusToneClass draws only from the design tokens", () => {
  const OFF_PALETTE = /emerald|amber-\d|sky|violet|slate|zinc|gray|green-\d|red-\d/

  test("no tone returns a raw Tailwind palette colour", () => {
    for (const tone of ALL_TONES) {
      expect(statusToneClass(tone)).not.toMatch(OFF_PALETTE)
    }
  })

  test("a live session reads at full ink", () => {
    expect(statusToneClass("active")).toBe("text-foreground")
  })

  test("failure uses the AA-checked destructive text token, not the logo coral", () => {
    expect(statusToneClass("destructive")).toBe("text-destructive-text")
  })
})

describe("workflowStatusLabel", () => {
  test("running → Running", () => expect(workflowStatusLabel("running")).toBe("Running"))
  test("completed → Completed", () => expect(workflowStatusLabel("completed")).toBe("Completed"))
  test("failed → Failed", () => expect(workflowStatusLabel("failed")).toBe("Failed"))
  test("killed → Killed", () => expect(workflowStatusLabel("killed")).toBe("Killed"))
  test("unknown → Unknown", () => expect(workflowStatusLabel("unknown")).toBe("Unknown"))
})

describe("workflowStatusTone", () => {
  test("running → active", () => expect(workflowStatusTone("running")).toBe("active"))
  test("failed → destructive", () => expect(workflowStatusTone("failed")).toBe("destructive"))
  test("killed → attention", () => expect(workflowStatusTone("killed")).toBe("attention"))
  test("completed → muted", () => expect(workflowStatusTone("completed")).toBe("muted"))
  test("unknown → muted", () => expect(workflowStatusTone("unknown")).toBe("muted"))
  test("killed still reads as the warning tone, in the project's amber token", () => {
    expect(statusToneClass(workflowStatusTone("killed"))).toBe("text-warning-text")
  })
})
