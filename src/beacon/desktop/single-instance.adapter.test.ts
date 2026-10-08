import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listenAsPrimaryInstance, notifyRunningInstance, type InstanceMessage } from "./single-instance.adapter"

let dir = ""

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "beacon-instance-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test("a second launch hands its link to the running instance", async () => {
  const endpoint = join(dir, "app.sock")
  const received: InstanceMessage[] = []
  const primary = await listenAsPrimaryInstance(endpoint, (message) => received.push(message))
  expect(await notifyRunningInstance(endpoint, { kind: "link", url: "kanna-beacon://pair?x=1" })).toBe(true)
  expect(await notifyRunningInstance(endpoint, { kind: "show" })).toBe(true)
  primary.close()
  expect(received).toEqual([{ kind: "link", url: "kanna-beacon://pair?x=1" }, { kind: "show" }])
})

test("with nothing running the notification reports that it was not delivered", async () => {
  expect(await notifyRunningInstance(join(dir, "nobody.sock"), { kind: "show" })).toBe(false)
})

test("a socket file left behind by a crash does not stop the next instance from listening", async () => {
  const endpoint = join(dir, "app.sock")
  writeFileSync(endpoint, "")
  const primary = await listenAsPrimaryInstance(endpoint, () => {})
  expect(await notifyRunningInstance(endpoint, { kind: "show" })).toBe(true)
  primary.close()
})
