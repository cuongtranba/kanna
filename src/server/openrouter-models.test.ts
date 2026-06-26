import { describe, expect, test } from "bun:test"
import { parseOpenRouterModels, OpenRouterModelCache } from "./openrouter-models"

const RAW = {
  data: [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", context_length: 200000, supported_parameters: ["tools", "temperature"] },
    { id: "x/no-tools", name: "No Tools", context_length: 8000, supported_parameters: ["temperature"] },
  ],
}

describe("parseOpenRouterModels", () => {
  test("keeps only tool-capable models, mapped to OpenRouterModel", () => {
    expect(parseOpenRouterModels(RAW)).toEqual([
      { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", contextLength: 200000 },
    ])
  })
  test("tolerates missing fields without throwing", () => {
    expect(parseOpenRouterModels({})).toEqual([])
    expect(parseOpenRouterModels({ data: [{ id: "y", supported_parameters: ["tools"] }] }))
      .toEqual([{ id: "y", label: "y", contextLength: 0 }])
  })
})

describe("pricing parsing", () => {
  test("parses per-token pricing when present", () => {
    const models = parseOpenRouterModels({
      data: [{
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        context_length: 200000,
        supported_parameters: ["tools"],
        pricing: { prompt: "0.000003", completion: "0.000015" },
      }],
    })
    expect(models[0]?.pricing).toEqual({ promptPerTok: 0.000003, completionPerTok: 0.000015 })
  })

  test("omits pricing when fields are missing or malformed", () => {
    const models = parseOpenRouterModels({
      data: [{
        id: "x/y",
        supported_parameters: ["tools"],
        pricing: { prompt: "abc" },
      }],
    })
    expect(models[0]?.pricing).toBeUndefined()
  })
})

describe("OpenRouterModelCache", () => {
  test("fetches once, serves cache within TTL, refetches after TTL", async () => {
    let calls = 0
    let now = 1000
    const cache = new OpenRouterModelCache({
      fetchRaw: async () => { calls++; return RAW },
      ttlMs: 100,
      now: () => now,
    })
    expect((await cache.list()).length).toBe(1)
    expect((await cache.list()).length).toBe(1)
    expect(calls).toBe(1)
    now = 1200
    await cache.list()
    expect(calls).toBe(2)
  })
  test("on fetch failure returns last good list", async () => {
    let fail = false
    const cache = new OpenRouterModelCache({
      fetchRaw: async () => { if (fail) throw new Error("net"); return RAW },
      ttlMs: 0,
      now: () => Date.now(),
    })
    await cache.list()
    fail = true
    expect((await cache.list()).length).toBe(1)
  })
  test("throws if first fetch fails and no cache exists", async () => {
    const cache = new OpenRouterModelCache({
      fetchRaw: async () => { throw new Error("net") },
      ttlMs: 1000,
      now: () => 0,
    })
    await expect(cache.list()).rejects.toThrow("net")
  })
})
