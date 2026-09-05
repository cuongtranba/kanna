
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"
import { errorMessage, toError } from "../errors"

export const REBALANCE_KEY_LENGTH = 48

export class InvalidRankError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidRankError"
  }
}

const ORDER_KEY_PATTERN = /^[0-9A-Za-z]+$/

function assertValidRank(rank: string | null, label: string): void {
  if (rank === null) return
  if (!ORDER_KEY_PATTERN.test(rank)) {
    throw new InvalidRankError(`${label} is not a valid order key: ${JSON.stringify(rank)}`)
  }
}

function wrapRankError(error: Error, context: string): never {
  throw new InvalidRankError(`${context}: ${errorMessage(error)}`)
}

export function rankBetween(above: string | null, below: string | null): string {
  assertValidRank(above, "above rank")
  assertValidRank(below, "below rank")
  if (above !== null && below !== null && above >= below) {
    throw new InvalidRankError(
      `cannot rank between ${JSON.stringify(above)} and ${JSON.stringify(below)}: bounds are not in order`,
    )
  }
  try {
    return generateKeyBetween(above, below)
  } catch (error) {
    return wrapRankError(toError(error), "failed to generate a rank")
  }
}

export function initialRank(): string {
  return rankBetween(null, null)
}

export function ranksBetween(above: string | null, below: string | null, count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new InvalidRankError(`count must be a non-negative integer, received ${String(count)}`)
  }
  if (count === 0) return []
  assertValidRank(above, "above rank")
  assertValidRank(below, "below rank")
  if (above !== null && below !== null && above >= below) {
    throw new InvalidRankError(
      `cannot rank between ${JSON.stringify(above)} and ${JSON.stringify(below)}: bounds are not in order`,
    )
  }
  try {
    return generateNKeysBetween(above, below, count)
  } catch (error) {
    return wrapRankError(toError(error), `failed to generate ${count} ranks`)
  }
}

export function needsRebalance(rank: string): boolean {
  return rank.length > REBALANCE_KEY_LENGTH
}

export function rebalancedRanks(count: number): string[] {
  return ranksBetween(null, null, count)
}
