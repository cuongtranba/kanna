import type { TranscriptEntry } from "../../src/shared/types"

export const ENTRY_SIZE_PERCENTILES = {
  p50: 1738,
  p95: 18818,
  max: 898755,
} as const

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

const FAT_ENTRY_BYTES = 10_000

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

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

function filler(bytes: number, rng: () => number): string {
  if (bytes <= 0) return ""
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 "
  let out = ""
  while (out.length < bytes) {
    out += alphabet[Math.floor(rng() * alphabet.length)] ?? "x"
  }
  return out.slice(0, bytes)
}

export function makeSizedEntry(i: number, targetBytes: number, rng: () => number): TranscriptEntry {
  const createdAt = 1700000000000 + i
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

export function summarizeSizes(sizes: readonly number[]): SizeSummary {
  if (sizes.length === 0) return { p50: 0, p95: 0, max: 0 }
  const sorted = [...sizes].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? 0
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 }
}
