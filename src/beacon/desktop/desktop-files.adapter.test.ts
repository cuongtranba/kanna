import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BeaconActivity } from "../activity"
import { createActivityLog, createLineLog, createPrefsStore } from "./desktop-files.adapter"

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-desktop-files-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function activity(id: string): BeaconActivity {
  return { id, at: Number(id), verb: "read", target: `/f/${id}`, outcome: { kind: "done" } }
}

test("prefs round-trip and a missing or damaged file reads as unset", async () => {
  const path = join(dir, "nested", "desktop.json")
  const store = createPrefsStore(path)
  expect(await store.load()).toBeNull()
  await store.save({ paused: true, launchAtLogin: false })
  expect(await store.load()).toEqual({ paused: true, launchAtLogin: false })
  writeFileSync(path, "{not json")
  expect(await store.load()).toBeNull()
})

test("the activity log keeps only its newest entries and skips damaged lines", async () => {
  const path = join(dir, "activity.jsonl")
  const log = createActivityLog(path, 3)
  for (const id of ["1", "2", "3", "4", "5"]) await log.append(activity(id))
  expect((await log.load()).map((entry) => entry.id)).toEqual(["3", "4", "5"])
  expect(readFileSync(path, "utf8").trim().split("\n").length).toBeLessThanOrEqual(3 + 2)
  writeFileSync(path, `${JSON.stringify(activity("7"))}\ngarbage\n${JSON.stringify({ id: "x" })}\n`)
  expect((await log.load()).map((entry) => entry.id)).toEqual(["7"])
  await log.clear()
  expect(await log.load()).toEqual([])
})

test("the line log starts over instead of growing past its cap", () => {
  const path = join(dir, "logs", "desktop.log")
  const log = createLineLog(path, 120)
  log("first line")
  log("second line")
  expect(readFileSync(path, "utf8").split("\n").filter(Boolean)).toHaveLength(2)
  log("x".repeat(80))
  expect(readFileSync(path, "utf8").split("\n").filter(Boolean)).toHaveLength(1)
})
