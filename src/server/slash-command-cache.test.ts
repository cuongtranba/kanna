import { describe, test, expect } from "bun:test"
import { SlashCommandCache } from "./slash-command-cache"
import type { SlashCommand } from "../shared/types"

const cmd = (name: string): SlashCommand => ({ name, description: "", argumentHint: "" })

describe("SlashCommandCache", () => {
  test("returns null on miss, stored value on hit", () => {
    const cache = new SlashCommandCache()
    expect(cache.get("/a")).toBeNull()
    cache.set("/a", [cmd("help")])
    expect(cache.get("/a")?.map((c) => c.name)).toEqual(["help"])
  })

  test("scopes by cwd", () => {
    const cache = new SlashCommandCache()
    cache.set("/a", [cmd("x")])
    expect(cache.get("/b")).toBeNull()
  })

  test("expires after the TTL", () => {
    let clock = 1000
    const cache = new SlashCommandCache(100, () => clock)
    cache.set("/a", [cmd("x")])
    clock = 1099
    expect(cache.get("/a")).not.toBeNull()
    clock = 1101
    expect(cache.get("/a")).toBeNull()
  })

  test("does not cache an empty list", () => {
    const cache = new SlashCommandCache()
    cache.set("/a", [])
    expect(cache.get("/a")).toBeNull()
  })

  test("clear() empties the cache", () => {
    const cache = new SlashCommandCache()
    cache.set("/a", [cmd("x")])
    cache.clear()
    expect(cache.get("/a")).toBeNull()
  })
})
