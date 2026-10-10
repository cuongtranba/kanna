import { describe, expect, test } from "bun:test"
import {
  BEACON_RELEASE_TARGETS,
  UNSUPPORTED_UPDATER,
  UPDATE_RETRY_BACKOFF_MS,
  decideUpdate,
  isBunRuntimePath,
  parseSha256Sums,
  releaseAssetFor,
  releaseAssetUrl,
  type UpdateDecisionInput,
} from "./self-update"

const NOW = 10_000_000

function input(overrides: Partial<UpdateDecisionInput>): UpdateDecisionInput {
  return {
    beaconVersion: "1.70.0",
    serverVersion: "1.71.0",
    trigger: "auto",
    autoEnabled: true,
    lastFailure: null,
    now: NOW,
    ...overrides,
  }
}

describe("decideUpdate", () => {
  test("installs the server's version when the beacon is behind it", () => {
    expect(decideUpdate(input({}))).toEqual({ kind: "install", version: "1.71.0" })
    expect(decideUpdate(input({ trigger: "manual" }))).toEqual({ kind: "install", version: "1.71.0" })
  })

  test("never downgrades to an older server", () => {
    expect(decideUpdate(input({ beaconVersion: "1.72.0" }))).toEqual({ kind: "none" })
    expect(decideUpdate(input({ beaconVersion: "1.72.0", trigger: "manual" }))).toEqual({ kind: "current" })
  })

  test("never reinstalls the same version: manual says current, auto stays quiet", () => {
    expect(decideUpdate(input({ beaconVersion: "1.71.0", trigger: "manual" }))).toEqual({ kind: "current" })
    expect(decideUpdate(input({ beaconVersion: "1.71.0" }))).toEqual({ kind: "none" })
  })

  test("with auto-update disabled only a manual trigger proceeds", () => {
    expect(decideUpdate(input({ autoEnabled: false }))).toEqual({ kind: "none" })
    expect(decideUpdate(input({ autoEnabled: false, trigger: "manual" }))).toEqual({ kind: "install", version: "1.71.0" })
  })

  test("auto backs off for 30 minutes after a failure for the same version", () => {
    const failedJustNow = { version: "1.71.0", at: NOW - 1 }
    const failedLongAgo = { version: "1.71.0", at: NOW - UPDATE_RETRY_BACKOFF_MS }
    expect(decideUpdate(input({ lastFailure: failedJustNow }))).toEqual({ kind: "none" })
    expect(decideUpdate(input({ lastFailure: failedLongAgo }))).toEqual({ kind: "install", version: "1.71.0" })
  })

  test("a failure for a different version does not hold back the new one", () => {
    expect(decideUpdate(input({ lastFailure: { version: "1.70.5", at: NOW - 1 } }))).toEqual({
      kind: "install",
      version: "1.71.0",
    })
  })

  test("manual ignores the auto backoff", () => {
    expect(decideUpdate(input({ trigger: "manual", lastFailure: { version: "1.71.0", at: NOW - 1 } }))).toEqual({
      kind: "install",
      version: "1.71.0",
    })
  })

  test("an unknown or malformed server version is never acted on", () => {
    expect(decideUpdate(input({ serverVersion: null, trigger: "manual" }))).toEqual({ kind: "none" })
    expect(decideUpdate(input({ serverVersion: "9.9.9/../../evil", trigger: "manual" }))).toEqual({ kind: "none" })
    expect(decideUpdate(input({ serverVersion: "v9.9.9" }))).toEqual({ kind: "none" })
  })
})

describe("release assets", () => {
  test("the asset table is exactly what the release publishes", () => {
    expect(BEACON_RELEASE_TARGETS.map((target) => [target.bunTarget, target.platform, target.arch, target.asset])).toEqual([
      ["bun-darwin-arm64", "darwin", "arm64", "kanna-beacon-darwin-arm64"],
      ["bun-darwin-x64", "darwin", "x64", "kanna-beacon-darwin-x64"],
      ["bun-linux-x64", "linux", "x64", "kanna-beacon-linux-x64"],
      ["bun-linux-arm64", "linux", "arm64", "kanna-beacon-linux-arm64"],
      ["bun-windows-x64", "win32", "x64", "kanna-beacon-windows-x64.exe"],
    ])
  })

  test("picks the asset for a platform and arch, and none for an unsupported pair", () => {
    expect(releaseAssetFor("darwin", "arm64")).toBe("kanna-beacon-darwin-arm64")
    expect(releaseAssetFor("win32", "x64")).toBe("kanna-beacon-windows-x64.exe")
    expect(releaseAssetFor("win32", "ia32")).toBeNull()
    expect(releaseAssetFor("freebsd", "x64")).toBeNull()
  })

  test("builds the tagged release url under the fixed base", () => {
    expect(releaseAssetUrl("https://github.com/cuongtranba/kanna/releases/download", "1.71.0", "SHA256SUMS")).toBe(
      "https://github.com/cuongtranba/kanna/releases/download/v1.71.0/SHA256SUMS",
    )
    expect(releaseAssetUrl("http://127.0.0.1:9/rel/", "1.71.0", "a")).toBe("http://127.0.0.1:9/rel/v1.71.0/a")
  })

  test("parses SHA256SUMS lines, with and without the binary marker", () => {
    const upper = "A".repeat(64)
    const lower = "b".repeat(64)
    const sums = parseSha256Sums(`${upper}  kanna-beacon-linux-x64\n${lower} *kanna-beacon-windows-x64.exe\r\nnot a line\n\n`)
    expect([...sums.entries()]).toEqual([
      ["kanna-beacon-linux-x64", "a".repeat(64)],
      ["kanna-beacon-windows-x64.exe", lower],
    ])
  })

  test("recognises the bun runtime, not a released binary", () => {
    expect(isBunRuntimePath("/Users/me/.bun/bin/bun")).toBe(true)
    expect(isBunRuntimePath("C:\\bun\\bun.exe")).toBe(true)
    expect(isBunRuntimePath("/usr/local/bin/kanna-beacon")).toBe(false)
  })

  test("the unsupported updater reports failure instead of pretending", async () => {
    const steps: string[] = []
    const result = await UNSUPPORTED_UPDATER.install("1.71.0", {
      onStep: (step) => void steps.push(step),
      beforeSwap: async () => {},
    })
    expect(result.ok).toBe(false)
    expect(steps).toEqual([])
  })
})
