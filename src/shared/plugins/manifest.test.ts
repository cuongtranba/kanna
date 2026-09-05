import { describe, expect, test } from "bun:test"
import {
  KANNA_PLUGIN_API_VERSION,
  KANNA_PLUGIN_MANIFEST_FILENAME,
  PLUGIN_ID_PATTERN,
  isValidPluginId,
  parseKannaPluginManifest,
  resolvePluginEntry,
} from "./manifest"

function ok(json: Record<string, unknown>) {
  return parseKannaPluginManifest(JSON.stringify(json))
}

describe("plugin id rules", () => {
  test.each([
    ["hello", true],
    ["hello-kanna", true],
    ["a1", true],
    ["a".repeat(64), true],
    ["", false],
    ["a", false],
    ["A".repeat(4), false],
    ["1hello", false],
    ["-hello", false],
    ["hello_kanna", false],
    ["hello.kanna", false],
    ["hello/../etc", false],
    ["a".repeat(65), false],
  ])("isValidPluginId(%p) === %p", (id, expected) => {
    expect(isValidPluginId(id)).toBe(expected)
  })

  test("the pattern is anchored on both ends", () => {
    expect(PLUGIN_ID_PATTERN.source.startsWith("^")).toBe(true)
    expect(PLUGIN_ID_PATTERN.source.endsWith("$")).toBe(true)
  })

  test("the reserved host id is refused", () => {
    expect(ok({ id: "kanna", name: "X", version: "1.0.0", kannaPluginApi: 1 })).toMatchObject({
      ok: false,
      code: "reserved_id",
    })
  })
})

describe("parseKannaPluginManifest", () => {
  test("accepts a minimal valid manifest", () => {
    const result = ok({ id: "hello", name: "Hello", version: "0.1.0", kannaPluginApi: 1 })
    expect(result).toEqual({
      ok: true,
      manifest: { id: "hello", name: "Hello", version: "0.1.0", kannaPluginApi: 1, entry: null },
    })
  })

  test("keeps an explicit entry", () => {
    const result = ok({ id: "hello", name: "Hello", version: "0.1.0", kannaPluginApi: 1, entry: "src/main.ts" })
    expect(result).toMatchObject({ ok: true, manifest: { entry: "src/main.ts" } })
  })

  test.each([
    ["not json at all", "invalid_json"],
    ["[]", "not_an_object"],
    ["null", "not_an_object"],
    ['"a string"', "not_an_object"],
  ])("rejects %p as %p", (raw, code) => {
    expect(parseKannaPluginManifest(raw)).toMatchObject({ ok: false, code })
  })

  test.each([
    [{ name: "X", version: "1.0.0", kannaPluginApi: 1 }, "invalid_id"],
    [{ id: "Bad Id", name: "X", version: "1.0.0", kannaPluginApi: 1 }, "invalid_id"],
    [{ id: "hello", version: "1.0.0", kannaPluginApi: 1 }, "invalid_name"],
    [{ id: "hello", name: "   ", version: "1.0.0", kannaPluginApi: 1 }, "invalid_name"],
    [{ id: "hello", name: "X", kannaPluginApi: 1 }, "invalid_version"],
    [{ id: "hello", name: "X", version: "1.0.0" }, "unsupported_api"],
    [{ id: "hello", name: "X", version: "1.0.0", kannaPluginApi: 2 }, "unsupported_api"],
    [{ id: "hello", name: "X", version: "1.0.0", kannaPluginApi: "1" }, "unsupported_api"],
  ])("rejects %o as %p", (json, code) => {
    expect(ok(json)).toMatchObject({ ok: false, code })
  })

  test.each([
    "/absolute/main.ts",
    "../outside.ts",
    "nested/../../escape.ts",
    "",
  ])("rejects entry %p as invalid_entry", (entry) => {
    expect(ok({ id: "hello", name: "X", version: "1.0.0", kannaPluginApi: 1, entry })).toMatchObject({
      ok: false,
      code: "invalid_entry",
    })
  })

  test("every failure carries a human-readable message naming the field", () => {
    const result = ok({ id: "Bad Id", name: "X", version: "1.0.0", kannaPluginApi: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.message).toContain("id")
    expect(result.message.length).toBeGreaterThan(10)
  })

  test("the api version constant matches what a v1 manifest declares", () => {
    expect(KANNA_PLUGIN_API_VERSION).toBe(1)
  })

  test("the manifest filename does not collide with Claude Code's plugin catalog", () => {
    expect(KANNA_PLUGIN_MANIFEST_FILENAME).toBe("kanna-plugin.json")
  })
})

describe("resolvePluginEntry", () => {
  test("defaults to index.ts when the manifest names no entry", () => {
    expect(resolvePluginEntry(null)).toBe("index.ts")
  })

  test("returns the declared entry verbatim", () => {
    expect(resolvePluginEntry("src/main.tsx")).toBe("src/main.tsx")
  })
})
