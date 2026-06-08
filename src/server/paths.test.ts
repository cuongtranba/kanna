import { describe, expect, test } from "bun:test"
import path from "node:path"

import { resolveSubagentRoots, SubagentRootsError } from "./paths"

const identityRealpath = (p: string) => p
const ROOT = "/repo/kanna"

describe("resolveSubagentRoots", () => {
  test("undefined workingDir + undefined allowedPaths -> cwd is parent, allowedPaths = [parent]", () => {
    const r = resolveSubagentRoots(ROOT, undefined, undefined, identityRealpath)
    expect(r.cwd).toBe(ROOT)
    expect(r.allowedPaths).toEqual([ROOT])
  })

  test("relative workingDir resolves under parent", () => {
    const r = resolveSubagentRoots(ROOT, "docs", undefined, identityRealpath)
    expect(r.cwd).toBe(path.join(ROOT, "docs"))
    expect(r.allowedPaths).toEqual([path.join(ROOT, "docs")])
  })

  test("relative allowedPaths array resolves under parent", () => {
    const r = resolveSubagentRoots(ROOT, undefined, ["docs", "wiki"], identityRealpath)
    expect(r.allowedPaths).toEqual([path.join(ROOT, "docs"), path.join(ROOT, "wiki")])
    expect(r.cwd).toBe(ROOT)
  })

  test("absolute workingDir rejected with INVALID_PATH", () => {
    expect(() => resolveSubagentRoots(ROOT, "/etc", undefined, identityRealpath))
      .toThrow(SubagentRootsError)
    try {
      resolveSubagentRoots(ROOT, "/etc", undefined, identityRealpath)
    } catch (e) {
      expect((e as SubagentRootsError).code).toBe("INVALID_PATH")
    }
  })

  test("tilde-prefixed path rejected", () => {
    expect(() => resolveSubagentRoots(ROOT, "~/foo", undefined, identityRealpath))
      .toThrow(SubagentRootsError)
  })

  test("../escape rejected with PATH_ESCAPE", () => {
    try {
      resolveSubagentRoots(ROOT, "../other", undefined, identityRealpath)
      throw new Error("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(SubagentRootsError)
      expect((e as SubagentRootsError).code).toBe("PATH_ESCAPE")
    }
  })

  test("symlink escape rejected via realpath fn", () => {
    const realpath = (p: string) => p === path.join(ROOT, "linked") ? "/outside/somewhere" : p
    try {
      resolveSubagentRoots(ROOT, "linked", undefined, realpath)
      throw new Error("should have thrown")
    } catch (e) {
      expect((e as SubagentRootsError).code).toBe("PATH_ESCAPE")
    }
  })

  test("empty allowedPaths array rejected with EMPTY_ALLOWED_PATHS", () => {
    try {
      resolveSubagentRoots(ROOT, undefined, [], identityRealpath)
      throw new Error("should have thrown")
    } catch (e) {
      expect((e as SubagentRootsError).code).toBe("EMPTY_ALLOWED_PATHS")
    }
  })

  test("empty string path rejected", () => {
    try {
      resolveSubagentRoots(ROOT, "  ", undefined, identityRealpath)
      throw new Error("should have thrown")
    } catch (e) {
      expect((e as SubagentRootsError).code).toBe("INVALID_PATH")
    }
  })

  test("non-absolute parentCwd rejected", () => {
    expect(() => resolveSubagentRoots("repo/kanna", undefined, undefined, identityRealpath))
      .toThrow(SubagentRootsError)
  })

  test("realpath folded for parent (macOS /var -> /private/var)", () => {
    const realpath = (p: string) => p.startsWith("/var") ? p.replace("/var", "/private/var") : p
    const r = resolveSubagentRoots("/var/folders/x", "docs", undefined, realpath)
    expect(r.cwd).toBe("/private/var/folders/x/docs")
  })
})
