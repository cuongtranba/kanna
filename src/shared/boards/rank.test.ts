import { describe, expect, test } from "bun:test"
import {
  InvalidRankError,
  REBALANCE_KEY_LENGTH,
  initialRank,
  needsRebalance,
  rankBetween,
  ranksBetween,
  rebalancedRanks,
} from "./rank"

const KEY_CHARACTERS = /^[0-9A-Za-z]+$/

function isWellFormed(rank: string): boolean {
  return rank.length > 0 && KEY_CHARACTERS.test(rank)
}

function isAscending(ranks: readonly string[]): boolean {
  return ranks.every((rank, index) => index === 0 || ranks[index - 1]! < rank)
}

describe("rankBetween", () => {
  test("an empty column produces one well-formed key", () => {
    const rank = rankBetween(null, null)
    expect(isWellFormed(rank)).toBe(true)
    expect(initialRank()).toBe(rank)
  })

  test("inserting at the top sorts before the existing key", () => {
    const existing = initialRank()
    const top = rankBetween(null, existing)
    expect(top < existing).toBe(true)
    expect(isWellFormed(top)).toBe(true)
  })

  test("inserting at the bottom sorts after the existing key", () => {
    const existing = initialRank()
    const bottom = rankBetween(existing, null)
    expect(bottom > existing).toBe(true)
    expect(isWellFormed(bottom)).toBe(true)
  })

  test("inserting between two keys lands strictly between them", () => {
    const first = initialRank()
    const second = rankBetween(first, null)
    const middle = rankBetween(first, second)
    expect(isAscending([first, middle, second])).toBe(true)
    expect(isWellFormed(middle)).toBe(true)
  })

  test("adjacent keys still yield a key between them", () => {
    const first = initialRank()
    const second = rankBetween(first, null)
    const middle = rankBetween(first, second)
    expect(isAscending([first, middle, second])).toBe(true)
    expect(middle.length).toBeGreaterThan(first.length)
  })

  test("keys sharing a long prefix still separate", () => {
    let lower = initialRank()
    let upper = rankBetween(lower, null)
    for (let index = 0; index < 8; index += 1) {
      upper = rankBetween(lower, upper)
    }
    const middle = rankBetween(lower, upper)
    expect(isAscending([lower, middle, upper])).toBe(true)
    expect(isWellFormed(middle)).toBe(true)
    lower = middle
    expect(isAscending([lower, rankBetween(lower, upper), upper])).toBe(true)
  })

  test("repeated insertion into the same gap stays ordered 200 deep", () => {
    const lower = initialRank()
    let upper = rankBetween(lower, null)
    for (let index = 0; index < 200; index += 1) {
      const next = rankBetween(lower, upper)
      expect(isAscending([lower, next, upper])).toBe(true)
      expect(isWellFormed(next)).toBe(true)
      upper = next
    }
  })

  test("sequential appends stay sorted AND stay short", () => {
    const ranks: string[] = []
    let previous: string | null = null
    for (let index = 0; index < 500; index += 1) {
      previous = rankBetween(previous, null)
      ranks.push(previous)
    }
    expect(isAscending(ranks)).toBe(true)
    expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(10)
  })

  test("sequential prepends stay sorted and stay short", () => {
    const ranks: string[] = []
    let next: string | null = null
    for (let index = 0; index < 500; index += 1) {
      next = rankBetween(null, next)
      ranks.unshift(next)
    }
    expect(isAscending(ranks)).toBe(true)
    expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(10)
  })

  test("simulating a real drag keeps the column order consistent", () => {
    const column = ranksBetween(null, null, 5)
    expect(isAscending(column)).toBe(true)

    const moved = rankBetween(column[1]!, column[2]!)
    expect(isAscending([column[0]!, column[1]!, moved, column[2]!, column[3]!, column[4]!])).toBe(true)
  })

  test("rejects bounds that are out of order", () => {
    const lower = initialRank()
    const upper = rankBetween(lower, null)
    expect(() => rankBetween(upper, lower)).toThrow(InvalidRankError)
  })

  test("rejects equal bounds", () => {
    const rank = initialRank()
    expect(() => rankBetween(rank, rank)).toThrow(InvalidRankError)
  })

  test("rejects a key outside the alphabet", () => {
    expect(() => rankBetween("a!", null)).toThrow(InvalidRankError)
  })

  test("rejects a malformed order key", () => {
    expect(() => rankBetween("Z", null)).toThrow(InvalidRankError)
  })
})

describe("ranksBetween", () => {
  test("returns the requested count in ascending order", () => {
    const ranks = ranksBetween(null, null, 12)
    expect(ranks).toHaveLength(12)
    expect(isAscending(ranks)).toBe(true)
    expect(ranks.every(isWellFormed)).toBe(true)
  })

  test("stays strictly inside the given bounds", () => {
    const lower = initialRank()
    const upper = rankBetween(lower, null)
    const ranks = ranksBetween(lower, upper, 20)
    expect(isAscending(ranks)).toBe(true)
    expect(ranks.every((rank) => lower < rank && rank < upper)).toBe(true)
  })

  test("a bulk import of 500 cards stays ordered, unique, and short", () => {
    const ranks = ranksBetween(null, null, 500)
    expect(ranks).toHaveLength(500)
    expect(isAscending(ranks)).toBe(true)
    expect(new Set(ranks).size).toBe(500)
    expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(10)
  })

  test("zero yields nothing", () => {
    expect(ranksBetween(null, null, 0)).toEqual([])
  })

  test("rejects a negative or fractional count", () => {
    expect(() => ranksBetween(null, null, -1)).toThrow(InvalidRankError)
    expect(() => ranksBetween(null, null, 1.5)).toThrow(InvalidRankError)
  })

  test("rejects bounds that are out of order", () => {
    const lower = initialRank()
    const upper = rankBetween(lower, null)
    expect(() => ranksBetween(upper, lower, 3)).toThrow(InvalidRankError)
  })
})

describe("needsRebalance", () => {
  test("is false for ordinary keys", () => {
    expect(needsRebalance(initialRank())).toBe(false)
  })

  test("is false across a realistic bulk import", () => {
    expect(ranksBetween(null, null, 500).some(needsRebalance)).toBe(false)
  })

  test("is true past the threshold", () => {
    expect(needsRebalance("a".repeat(REBALANCE_KEY_LENGTH + 1))).toBe(true)
  })

  test("rebalanced ranks are short and ordered", () => {
    const ranks = rebalancedRanks(50)
    expect(isAscending(ranks)).toBe(true)
    expect(ranks.every((rank) => !needsRebalance(rank))).toBe(true)
  })
})
