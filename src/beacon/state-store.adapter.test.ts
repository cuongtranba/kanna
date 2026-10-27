import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStateStore } from "./state-store.adapter"

let dir: string | null = null

afterEach(async () => {
  if (dir !== null) await rm(dir, { recursive: true, force: true })
  dir = null
})

describe("createStateStore", () => {
  test("loads the kanna url without trailing slashes so callers join routes onto it directly", async () => {
    dir = await mkdtemp(join(tmpdir(), "beacon-state-"))
    const path = join(dir, "state.json")
    await writeFile(path, JSON.stringify({ kannaUrl: "https://kanna.example//", beaconId: "b-1" }))
    expect(await createStateStore(path).load()).toEqual({ kannaUrl: "https://kanna.example", beaconId: "b-1" })
  })
})
