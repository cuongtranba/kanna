import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(import.meta.dir, "..", "..")
const CONFIG_PATH = join(REPO_ROOT, ".gitleaks.toml")

type GitleaksAllowlist = {
  description?: string
  regexTarget?: string
  regexes?: string[]
  stopwords?: string[]
  paths?: string[]
}

type GitleaksConfig = {
  title: string
  allowlist: GitleaksAllowlist
}

const KNOWN_SYNTHETIC_TOKENS = [
  "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz1234",
  "sk-ant-oat01-SECRETMIDDLESEGMENT1234",
  "sk-or-v1-abcdef1234567890",
  "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh",
]

const KNOWN_STOPWORDS = [
  "sk-ant-test",
  "sk-ant-abc",
  "sk-ant-bad",
  "sk-ant-existing",
  "sk-ant-abcdef1234",
  "should-be-stripped",
]

function loadConfig(): GitleaksConfig {
  return Bun.TOML.parse(readFileSync(CONFIG_PATH, "utf8")) as GitleaksConfig
}

describe("gitleaks config", () => {
  test(".gitleaks.toml exists at repo root", () => {
    expect(() => readFileSync(CONFIG_PATH, "utf8")).not.toThrow()
  })

  test("parses as valid TOML", () => {
    const source = readFileSync(CONFIG_PATH, "utf8")
    expect(() => Bun.TOML.parse(source)).not.toThrow()
  })

  test("has a title field", () => {
    const config = loadConfig()
    expect(typeof config.title).toBe("string")
    expect(config.title.length).toBeGreaterThan(0)
  })

  test("has an allowlist section with regexes and stopwords", () => {
    const { allowlist } = loadConfig()
    expect(Array.isArray(allowlist.regexes)).toBe(true)
    expect(Array.isArray(allowlist.stopwords)).toBe(true)
    expect((allowlist.regexes ?? []).length).toBeGreaterThan(0)
    expect((allowlist.stopwords ?? []).length).toBeGreaterThan(0)
  })

  test("allowlist.regexes cover every known synthetic-token prefix", () => {
    const { allowlist } = loadConfig()
    const regexes = (allowlist.regexes ?? []).map((r) => new RegExp(r))

    for (const token of KNOWN_SYNTHETIC_TOKENS) {
      const matched = regexes.some((rx) => rx.test(token))
      expect(matched, `No allowlist regex covers synthetic token: ${token}`).toBe(true)
    }
  })

  test("allowlist.stopwords cover every known short stub value", () => {
    const { allowlist } = loadConfig()
    const stopwords = (allowlist.stopwords ?? []).map((s) => s.toLowerCase())

    for (const stub of KNOWN_STOPWORDS) {
      const covered = stopwords.some((w) => stub.toLowerCase().includes(w) || w.includes(stub.toLowerCase()))
      expect(covered, `Stopwords do not cover stub value: ${stub}`).toBe(true)
    }
  })

  test("allowlist.regexTarget is set to 'line'", () => {
    const { allowlist } = loadConfig()
    expect(allowlist.regexTarget).toBe("line")
  })
})
