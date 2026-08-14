import { describe, expect, test } from "bun:test"
import {
  statusLabel,
  statusTone,
  statusToneClass,
  statusToneDotClass,
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

describe("statusToneDotClass", () => {
  test("active → emerald dot", () => expect(statusToneDotClass("active")).toBe("bg-emerald-500 dark:bg-emerald-400"))
  test("attention → amber dot", () => expect(statusToneDotClass("attention")).toBe("bg-amber-500 dark:bg-amber-400"))
  test("destructive → destructive dot", () => expect(statusToneDotClass("destructive")).toBe("bg-destructive"))
  test("muted → muted dot", () => expect(statusToneDotClass("muted")).toBe("bg-muted-foreground"))
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
  test("killed keeps the amber classes the old warning tone rendered", () => {
    expect(statusToneClass(workflowStatusTone("killed"))).toBe("text-amber-500 dark:text-amber-400")
    expect(statusToneDotClass(workflowStatusTone("killed"))).toBe("bg-amber-500 dark:bg-amber-400")
  })
})
