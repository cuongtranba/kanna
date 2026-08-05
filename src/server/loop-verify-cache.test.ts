import { beforeEach, describe, expect, test } from "bun:test"
import {
  __resetVerifyCache,
  clearCachedVerify,
  getCachedVerify,
  setCachedVerify,
} from "./loop-verify-cache"

const RESULT = { exitCode: 1, output: "NOT DONE", timedOut: false, durationMs: 64_800 }

describe("loop verify cache", () => {
  beforeEach(() => {
    __resetVerifyCache()
  })

  test("returns null before anything is recorded", () => {
    expect(getCachedVerify("c1", "make check", "digest-a")).toBeNull()
  })

  test("round-trips a result for the same chat + command + digest", () => {
    setCachedVerify("c1", "make check", "digest-a", RESULT)
    expect(getCachedVerify("c1", "make check", "digest-a")).toEqual(RESULT)
  })

  // The whole point: a changed tree must re-run, never reuse.
  test("a different digest misses", () => {
    setCachedVerify("c1", "make check", "digest-a", RESULT)
    expect(getCachedVerify("c1", "make check", "digest-b")).toBeNull()
  })

  test("a different command misses", () => {
    setCachedVerify("c1", "make check", "digest-a", RESULT)
    expect(getCachedVerify("c1", "make other", "digest-a")).toBeNull()
  })

  test("a different chat misses", () => {
    setCachedVerify("c1", "make check", "digest-a", RESULT)
    expect(getCachedVerify("c2", "make check", "digest-a")).toBeNull()
  })

  // A null digest means "tree state unknown" — caching that would serve a
  // remembered pass for a tree we cannot fingerprint.
  test("a null digest is never stored and never hits", () => {
    setCachedVerify("c1", "make check", null, RESULT)
    expect(getCachedVerify("c1", "make check", null)).toBeNull()
  })

  test("clearCachedVerify drops only the named chat's entries", () => {
    setCachedVerify("c1", "make check", "digest-a", RESULT)
    setCachedVerify("c2", "make check", "digest-a", RESULT)
    clearCachedVerify("c1")
    expect(getCachedVerify("c1", "make check", "digest-a")).toBeNull()
    expect(getCachedVerify("c2", "make check", "digest-a")).toEqual(RESULT)
  })

  test("evicts the oldest entries past the bound", () => {
    for (let i = 0; i < 80; i++) {
      setCachedVerify("c1", "make check", `digest-${i}`, { ...RESULT, exitCode: i })
    }
    expect(getCachedVerify("c1", "make check", "digest-0")).toBeNull()
    expect(getCachedVerify("c1", "make check", "digest-79")?.exitCode).toBe(79)
  })

  test("re-recording the same key refreshes rather than duplicating", () => {
    setCachedVerify("c1", "make check", "digest-a", RESULT)
    setCachedVerify("c1", "make check", "digest-a", { ...RESULT, exitCode: 0 })
    expect(getCachedVerify("c1", "make check", "digest-a")?.exitCode).toBe(0)
  })
})
