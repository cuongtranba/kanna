import { describe, expect, test } from "bun:test"
import { readIntEnv } from "./env-int"

describe("readIntEnv", () => {
  test("returns fallback for undefined", () => {
    expect(readIntEnv(undefined, 5)).toBe(5)
  })

  test("returns fallback for empty string", () => {
    expect(readIntEnv("", 5)).toBe(5)
    expect(readIntEnv("   ", 5)).toBe(5)
  })

  test("returns parsed value for valid positive integer", () => {
    expect(readIntEnv("10", 5)).toBe(10)
    expect(readIntEnv("1", 5)).toBe(1)
  })

  test("returns fallback for zero", () => {
    expect(readIntEnv("0", 5)).toBe(5)
  })

  test("returns fallback for negative integer", () => {
    expect(readIntEnv("-3", 5)).toBe(5)
  })

  test("returns fallback for non-integer float", () => {
    expect(readIntEnv("3.14", 5)).toBe(5)
  })

  test("accepts zero when the floor is zero", () => {
    expect(readIntEnv("0", 5, { min: 0 })).toBe(0)
  })

  test("returns fallback for trailing garbage", () => {
    expect(readIntEnv("15abc", 5)).toBe(5)
  })

  test("returns fallback for non-numeric string", () => {
    expect(readIntEnv("abc", 5)).toBe(5)
  })
})
