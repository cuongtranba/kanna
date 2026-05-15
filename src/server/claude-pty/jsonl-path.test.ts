import { describe, expect, test } from "bun:test"
import { computeJsonlPath, encodeCwd } from "./jsonl-path"

describe("encodeCwd", () => {
  test("absolute path: replaces / with -", () => {
    expect(encodeCwd("/Users/cuongtran")).toBe("-Users-cuongtran")
  })
  test("absolute path with trailing slash: trims it", () => {
    expect(encodeCwd("/Users/cuongtran/")).toBe("-Users-cuongtran")
  })
  test("nested path", () => {
    expect(encodeCwd("/Users/cuongtran/Desktop/repo/kanna")).toBe("-Users-cuongtran-Desktop-repo-kanna")
  })
  test("root path", () => {
    expect(encodeCwd("/")).toBe("-")
  })
})

describe("computeJsonlPath", () => {
  test("combines homeDir + encoded cwd + session uuid", () => {
    const result = computeJsonlPath({
      homeDir: "/home/u",
      cwd: "/Users/cuongtran",
      sessionId: "abc-123",
    })
    expect(result).toBe("/home/u/.claude/projects/-Users-cuongtran/abc-123.jsonl")
  })
})
