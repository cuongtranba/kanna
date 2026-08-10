/**
 * Transcript entry fixture for the long-session bench.
 *
 * WHY THIS EXISTS. The original fixture emitted one shape at one size —
 * `"lorem ipsum dolor sit amet ".repeat(40)`, ~1 KB, every entry. Under it a
 * 200-entry window weighs a fixed ~184 KB, so the July 2026 long-session OKR
 * measured a window whose cost could not vary with content and concluded the
 * initial page needed no byte bound. Real windows are heavy-tailed: the same
 * 200 entries weigh 0.47 MB in one chat and 3.89 MB in another, and that
 * spread — not entry count, not file size — is what a chat tab actually pays
 * on open. A fixture with no tail cannot express the failure it is meant to
 * catch.
 *
 * PROVENANCE. The percentiles below were measured on 2026-08-10 over the last
 * 200 entries of each of the 25 largest transcripts in a real store (n=5000
 * entries):
 *
 *   mean 8536 B | p10 655 | p25 1156 | p50 1738 | p75 2993
 *              | p90 7636 | p95 18818 | p99 212563 | max 898755
 *
 * Note the shape, not just the scale: the MEDIAN (1.7 KB) is within 2x of the
 * old fixture, which is why the old one looked plausible. The tail is what was
 * missing — p99 is 122x the median and the largest single entry is ~900 KB.
 *
 * `tool_result` carries that tail (34% of entries, mean 19.5 KB), so sampled
 * fat entries are emitted as tool_result to preserve the kind/size
 * correlation, not just the marginal distribution.
 *
 * RE-MEASURING. When the corpus shifts materially, re-run the measurement and
 * update BOTH the table and the docstring above. Keep the numbers and their
 * date together — a percentile with no provenance is indistinguishable from an
 * invented one, which is the failure this file exists to prevent.
 */
import type { TranscriptEntry } from "../../src/shared/types"

/** Headline percentiles of the measured distribution, for reporting. */
export const ENTRY_SIZE_PERCENTILES = {
  p50: 1738,
  p95: 18818,
  max: 898755,
} as const

/**
 * Inverse CDF of the measured entry-size distribution, as
 * [cumulativeProbability, bytes] knots. Sampling interpolates between knots.
 */
const SIZE_CDF: ReadonlyArray<readonly [number, number]> = [
  [0.00, 320],
  [0.10, 655],
  [0.25, 1156],
  [0.50, 1738],
  [0.75, 2993],
  [0.90, 7636],
  [0.95, 18818],
  [0.99, 212563],
  [1.00, 898755],
]

/** Entries at or above this size are emitted as tool_result (the fat kind). */
const FAT_ENTRY_BYTES = 10_000

/**
 * Deterministic PRNG (mulberry32). The bench must be replayable: a fixture
 * that reshuffles per run makes two bench numbers incomparable.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Draws one entry size in bytes from the measured distribution. */
export function sampleEntryBytes(rng: () => number): number {
  const u = rng()
  for (let i = 1; i < SIZE_CDF.length; i += 1) {
    const [pLo, bLo] = SIZE_CDF[i - 1]!
    const [pHi, bHi] = SIZE_CDF[i]!
    if (u <= pHi) {
      const span = pHi - pLo
      const t = span === 0 ? 0 : (u - pLo) / span
      return Math.max(1, Math.round(bLo + t * (bHi - bLo)))
    }
  }
  return SIZE_CDF[SIZE_CDF.length - 1]![1]
}

/** Filler that does not compress to nothing, so byte counts stay honest. */
function filler(bytes: number, rng: () => number): string {
  if (bytes <= 0) return ""
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 "
  let out = ""
  while (out.length < bytes) {
    out += alphabet[Math.floor(rng() * alphabet.length)] ?? "x"
  }
  return out.slice(0, bytes)
}

/**
 * Builds one transcript entry whose serialized size is approximately
 * `targetBytes`. Fat draws become tool_result; the rest rotate through the
 * kinds that dominate a real window.
 */
export function makeSizedEntry(i: number, targetBytes: number, rng: () => number): TranscriptEntry {
  const createdAt = 1700000000000 + i
  // Rough envelope overhead of the JSON scaffolding around the payload.
  const payloadBytes = Math.max(1, targetBytes - 120)

  if (targetBytes >= FAT_ENTRY_BYTES) {
    return {
      _id: `toolres-${i}`,
      createdAt,
      kind: "tool_result",
      toolId: `toolu_${i}`,
      content: filler(payloadBytes, rng),
    } as TranscriptEntry
  }

  switch (i % 4) {
    case 0:
      return {
        _id: `tool-${i}`,
        createdAt,
        kind: "tool_call",
        tool: {
          kind: "tool",
          toolKind: "bash",
          toolName: "Bash",
          toolId: `toolu_${i}`,
          input: { command: `echo ${filler(payloadBytes, rng)}` },
        },
      } as unknown as TranscriptEntry
    case 1:
      return {
        _id: `toolres-${i}`,
        createdAt,
        kind: "tool_result",
        toolId: `toolu_${i}`,
        content: filler(payloadBytes, rng),
      } as TranscriptEntry
    case 2:
      return {
        _id: `think-${i}`,
        createdAt,
        kind: "assistant_thinking",
        text: filler(payloadBytes, rng),
      } as TranscriptEntry
    default:
      return {
        _id: `text-${i}`,
        createdAt,
        kind: "assistant_text",
        text: filler(payloadBytes, rng),
      } as TranscriptEntry
  }
}

export interface SizeSummary {
  p50: number
  p95: number
  max: number
}

/** Percentiles of an emitted fixture, reported alongside every bench result. */
export function summarizeSizes(sizes: readonly number[]): SizeSummary {
  if (sizes.length === 0) return { p50: 0, p95: 0, max: 0 }
  const sorted = [...sizes].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 }
}
