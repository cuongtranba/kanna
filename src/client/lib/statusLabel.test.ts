import { describe, expect, test } from "bun:test"
import { statusLabel, statusTone } from "./statusLabel"

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
