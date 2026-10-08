import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createBeaconFs } from "./fs.adapter"
import { BeaconScopeError } from "./ports"

let base = ""
let root = ""
let outside = ""

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "beacon-fs-")))
  root = join(base, "root")
  outside = join(base, "outside")
  mkdirSync(root)
  mkdirSync(outside)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe("beacon fs adapter", () => {
  test("reads a windowed slice inside a root with the total size", async () => {
    writeFileSync(join(root, "a.txt"), "0123456789")
    const fs = createBeaconFs(() => [root])
    expect(await fs.read(join(root, "a.txt"), 2, 4)).toEqual({
      content: "2345",
      totalSize: 10,
      truncated: true,
      binary: false,
    })
  })

  test("refuses a path outside every root", async () => {
    writeFileSync(join(outside, "secret.txt"), "nope")
    const fs = createBeaconFs(() => [root])
    const failure = await fs.read(join(outside, "secret.txt"), 0, 10).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(BeaconScopeError)
  })

  test("refuses a symlink inside a root that points outside it", async () => {
    writeFileSync(join(outside, "secret.txt"), "nope")
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"))
    const fs = createBeaconFs(() => [root])
    const failure = await fs.read(join(root, "link.txt"), 0, 10).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(BeaconScopeError)
  })

  test("refuses a missing path whose nearest existing ancestor is outside the roots", async () => {
    const fs = createBeaconFs(() => [root])
    const failure = await fs.stat(join(outside, "ghost.txt")).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(BeaconScopeError)
  })

  test("marks a binary file instead of returning its bytes", async () => {
    writeFileSync(join(root, "blob.bin"), Buffer.from([1, 2, 0, 3]))
    const fs = createBeaconFs(() => [root])
    expect(await fs.read(join(root, "blob.bin"), 0, 10)).toEqual({
      content: "",
      totalSize: 4,
      truncated: false,
      binary: true,
    })
  })

  test("greps matching lines under the root and skips symlinked escapes", async () => {
    writeFileSync(join(root, "a.txt"), "alpha\nneedle here\n")
    writeFileSync(join(outside, "b.txt"), "needle outside\n")
    symlinkSync(outside, join(root, "escape"))
    const fs = createBeaconFs(() => [root])
    expect(await fs.grep(root, "needle")).toEqual({
      matches: [{ path: join(root, "a.txt"), line: 2, text: "needle here" }],
      truncated: false,
    })
  })

  test("fetches a file in resumable chunks with a running sha256", async () => {
    const payload = Buffer.alloc(300 * 1024, 7)
    writeFileSync(join(root, "big.dat"), payload)
    const fs = createBeaconFs(() => [root])
    const first = await fs.fetchChunk(join(root, "big.dat"), 0)
    const second = await fs.fetchChunk(join(root, "big.dat"), 256 * 1024)
    const resumed = await createBeaconFs(() => [root]).fetchChunk(join(root, "big.dat"), 256 * 1024)
    expect(first).toMatchObject({ from: 0, nextFrom: 256 * 1024, done: false, totalSize: payload.length })
    expect(second).toMatchObject({ nextFrom: payload.length, done: true })
    expect(resumed).toEqual(second)
    const expected = new Bun.CryptoHasher("sha256").update(payload).digest("hex")
    expect(second).toMatchObject({ sha256: expected })
  })
})
