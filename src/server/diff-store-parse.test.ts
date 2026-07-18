import { describe, expect, test } from "bun:test"
import {
  appendGitIgnoreEntry,
  countTextLines,
  getContentDigest,
  normalizeRepoRelativePath,
  parseNumstatValue,
  parseStatusPaths,
} from "./diff-store-parse"

describe("parseStatusPaths", () => {
  test("parses modified file", () => {
    const result = parseStatusPaths(" M src/foo.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: "src/foo.ts", changeType: "modified", isUntracked: false })
  })

  test("parses untracked file", () => {
    const result = parseStatusPaths("?? new-file.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: "new-file.ts", changeType: "added", isUntracked: true })
  })

  test("parses added file", () => {
    const result = parseStatusPaths("A  staged.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: "staged.ts", changeType: "added", isUntracked: false })
  })

  test("parses deleted file", () => {
    const result = parseStatusPaths(" D gone.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ path: "gone.ts", changeType: "deleted", isUntracked: false })
  })

  test("parses renamed file", () => {
    const result = parseStatusPaths("R  old.ts -> new.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      path: "new.ts",
      previousPath: "old.ts",
      changeType: "renamed",
      isUntracked: false,
    })
  })

  test("sorts results by path", () => {
    const output = "?? b.ts\n?? a.ts\n?? c.ts\n"
    const result = parseStatusPaths(output)
    expect(result.map((e) => e.path)).toEqual(["a.ts", "b.ts", "c.ts"])
  })

  test("ignores lines shorter than 4 chars", () => {
    const result = parseStatusPaths("AB\n M valid.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe("valid.ts")
  })

  test("skips lines with empty value after status code", () => {
    const result = parseStatusPaths(" M \n M real.ts\n")
    expect(result).toHaveLength(1)
    expect(result[0]?.path).toBe("real.ts")
  })

  test("returns empty array for empty input", () => {
    expect(parseStatusPaths("")).toEqual([])
    expect(parseStatusPaths("\n\n")).toEqual([])
  })
})

describe("getContentDigest", () => {
  test("returns a hex string", () => {
    const digest = getContentDigest({
      changeType: "modified",
      beforePath: "a.ts",
      afterPath: "a.ts",
      beforeText: "old",
      afterText: "new",
    })
    expect(digest).toMatch(/^[\da-f]{40}$/)
  })

  test("same inputs produce same digest", () => {
    const args = {
      changeType: "modified" as const,
      beforePath: "a.ts",
      afterPath: "a.ts",
      beforeText: "old",
      afterText: "new",
    }
    expect(getContentDigest(args)).toBe(getContentDigest(args))
  })

  test("different inputs produce different digests", () => {
    const base = {
      changeType: "modified" as const,
      beforePath: "a.ts",
      afterPath: "a.ts",
      beforeText: "old",
      afterText: "new",
    }
    const changed = { ...base, afterText: "different" }
    expect(getContentDigest(base)).not.toBe(getContentDigest(changed))
  })

  test("handles null text", () => {
    const digest = getContentDigest({
      changeType: "added",
      beforePath: "a.ts",
      afterPath: "a.ts",
      beforeText: null,
      afterText: "content",
    })
    expect(typeof digest).toBe("string")
    expect(digest).toHaveLength(40)
  })
})

describe("parseNumstatValue", () => {
  test("parses integer", () => {
    expect(parseNumstatValue("42")).toBe(42)
    expect(parseNumstatValue("0")).toBe(0)
  })

  test("returns 0 for binary marker", () => {
    expect(parseNumstatValue("-")).toBe(0)
  })

  test("returns 0 for empty string", () => {
    expect(parseNumstatValue("")).toBe(0)
    expect(parseNumstatValue("  ")).toBe(0)
  })

  test("returns 0 for non-numeric string", () => {
    expect(parseNumstatValue("abc")).toBe(0)
  })
})

describe("countTextLines", () => {
  test("counts lines", () => {
    expect(countTextLines("a\nb\nc\n")).toBe(3)
    expect(countTextLines("a\nb")).toBe(2)
  })

  test("returns 0 for null", () => {
    expect(countTextLines(null)).toBe(0)
  })

  test("returns 0 for empty string", () => {
    expect(countTextLines("")).toBe(0)
  })

  test("handles single line with trailing newline", () => {
    expect(countTextLines("hello\n")).toBe(1)
  })

  test("handles single line without trailing newline", () => {
    expect(countTextLines("hello")).toBe(1)
  })
})

describe("normalizeRepoRelativePath", () => {
  test("passes through simple paths", () => {
    expect(normalizeRepoRelativePath("src/foo.ts")).toBe("src/foo.ts")
  })

  test("strips leading ./", () => {
    expect(normalizeRepoRelativePath("./src/foo.ts")).toBe("src/foo.ts")
  })

  test("rejects absolute paths", () => {
    expect(() => normalizeRepoRelativePath("/etc/passwd")).toThrow("Invalid diff path")
  })

  test("rejects parent traversal", () => {
    expect(() => normalizeRepoRelativePath("../outside")).toThrow("Invalid diff path")
  })

  test("rejects embedded traversal", () => {
    expect(() => normalizeRepoRelativePath("src/../../../etc/passwd")).toThrow("Invalid diff path")
  })

  test("normalizes backslashes on Windows-style paths", () => {
    expect(normalizeRepoRelativePath("src\\foo.ts")).toBe("src/foo.ts")
  })
})

describe("appendGitIgnoreEntry", () => {
  test("adds entry to empty file", () => {
    expect(appendGitIgnoreEntry(null, "dist/")).toBe("dist/\n")
    expect(appendGitIgnoreEntry("", "dist/")).toBe("dist/\n")
  })

  test("appends entry to existing content", () => {
    expect(appendGitIgnoreEntry("node_modules/\n", "dist/")).toBe("node_modules/\ndist/\n")
  })

  test("does not duplicate existing entry", () => {
    const result = appendGitIgnoreEntry("dist/\n", "dist/")
    expect(result).toBe("dist/\n")
  })

  test("adds newline to file missing trailing newline before appending", () => {
    const result = appendGitIgnoreEntry("node_modules/", "dist/")
    expect(result).toBe("node_modules/\ndist/\n")
  })

  test("does not duplicate entry that exists without trailing newline", () => {
    const result = appendGitIgnoreEntry("dist/", "dist/")
    expect(result).toBe("dist/\n")
  })
})
