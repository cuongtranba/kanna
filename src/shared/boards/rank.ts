/**
 * Fractional indexing for board ordering.
 *
 * A card's position in its column is a short order key, not an integer. Moving
 * one card is therefore ONE row update — never a renumber of the whole column —
 * which keeps a drag O(1) against SQLite and stops two concurrent movers (a
 * user and an agent) from fighting over the same integers.
 *
 * Keys sort by plain lexicographic string comparison, which is the same order
 * SQLite's default BINARY collation gives, so `ORDER BY rank` needs no collation
 * clause and no application-side sort.
 *
 * ## Why this wraps a library rather than implementing the algorithm
 *
 * The midpoint half of fractional indexing is ~30 lines and easy to write; the
 * *integer part* is the half that is easy to get wrong and easy to not notice.
 * A hand-rolled midpoint-only implementation is correct on every ordering
 * assertion and still grows keys linearly under sequential appends — 500
 * appends produced a 100-character key, versus 3 characters here. That is a
 * silent storage and index regression, not a visible bug, so it survives review.
 *
 * `fractional-indexing` (CC0-1.0, zero dependencies) is the reference
 * implementation. This module is the seam: the rest of Kanna depends on the
 * names below, never on the package, so the implementation can be swapped
 * without touching a call site.
 *
 * @see https://github.com/rocicorp/fractional-indexing
 */

import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"
import { errorMessage, type AnyValue } from "../errors"

/**
 * Length past which a column should be rebalanced.
 *
 * Keys only grow when items are repeatedly inserted into the *same* gap:
 * appends and bulk inserts stay at 2-3 characters, while 200 inserts into one
 * gap reach ~36. Crossing this threshold means a column has been hammered, not
 * that it is merely large.
 */
export const REBALANCE_KEY_LENGTH = 48

export class InvalidRankError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidRankError"
  }
}

/** The only characters an order key may contain, under the default alphabet. */
const ORDER_KEY_PATTERN = /^[0-9A-Za-z]+$/

/**
 * Reject a key containing characters outside the alphabet.
 *
 * The library validates a key's *structure* (its integer part must match the
 * length its head declares) but not its *characters*: `generateKeyBetween("a!",
 * null)` returns `"a1"` instead of throwing. A rank that reached us corrupted —
 * from a hand-edited row, a bad migration, or an API caller — would then sort
 * somewhere arbitrary instead of failing loudly. Ordering corruption is silent
 * by nature, so it has to be caught at the boundary.
 */
function assertValidRank(rank: string | null, label: string): void {
  if (rank === null) return
  if (!ORDER_KEY_PATTERN.test(rank)) {
    throw new InvalidRankError(`${label} is not a valid order key: ${JSON.stringify(rank)}`)
  }
}

function wrapRankError(error: AnyValue, context: string): never {
  throw new InvalidRankError(`${context}: ${errorMessage(error)}`)
}

/**
 * Generate a rank that sorts strictly between `above` and `below`.
 *
 * `above` is null when inserting at the top of a column, `below` is null when
 * inserting at the bottom, and both are null for the first card in an empty
 * column.
 *
 * Bounds must be in order. The underlying library tolerates swapped bounds, but
 * a swap here always means the caller mixed up its neighbours — a drop handler
 * reading `taskAbove`/`taskBelow` backwards would otherwise silently produce a
 * correct-looking key in the wrong place.
 */
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
    return wrapRankError(error, "failed to generate a rank")
  }
}

/** The rank for the first card in an empty column. */
export function initialRank(): string {
  return rankBetween(null, null)
}

/**
 * `count` ranks in ascending order, all strictly between `above` and `below`.
 *
 * Used by GitHub import, which inserts many cards into one column at once.
 * Prefer this over calling {@link rankBetween} in a loop: the library spaces the
 * batch evenly in one pass, whereas a loop against a moving lower bound skews
 * every key toward the upper bound and lengthens them.
 */
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
    return wrapRankError(error, `failed to generate ${count} ranks`)
  }
}

/** True when `rank` has grown long enough that its column should be rebalanced. */
export function needsRebalance(rank: string): boolean {
  return rank.length > REBALANCE_KEY_LENGTH
}

/**
 * Evenly spaced ranks for `count` items, used to rewrite a column whose keys
 * have grown past {@link REBALANCE_KEY_LENGTH}.
 */
export function rebalancedRanks(count: number): string[] {
  return ranksBetween(null, null, count)
}
