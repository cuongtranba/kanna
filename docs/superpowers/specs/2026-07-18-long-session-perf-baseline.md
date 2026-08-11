# Long-Session Performance — Benchmark Record

Harness: `scripts/perf/long-session-bench.ts` (synthetic session: 2/3 ~1.1 KB
assistant_text entries, 1/3 Bash tool_call entries; recentLimit 200; 100 ticks).
Machine: WSL2 Linux dev box, Bun.

## Baseline (pre-change), 2026-07-18

```json
{
  "entries": 3000,
  "coldOpenMs": 11,
  "tickDeriveMs": 0.36,
  "signatureMs": 0.21,
  "tickStringifyMs": 0.21,
  "tickBytes": 184227
}
```

```json
{
  "entries": 10000,
  "coldOpenMs": 19.8,
  "tickDeriveMs": 0.48,
  "signatureMs": 0.11,
  "tickStringifyMs": 0.08,
  "tickBytes": 183431
}
```

## Post-change, 2026-07-18 (op-log + LRU + window-clone landed)

```json
{
  "entries": 3000,
  "coldOpenMs": 6.3,
  "tickDeriveMs": 0.09,
  "signatureMs": 0.15,
  "tickStringifyMs": 0.15,
  "tickBytes": 184227,
  "opsTickMs": 0.007,
  "opsTickBytes": 557
}
```

```json
{
  "entries": 10000,
  "coldOpenMs": 18.8,
  "tickDeriveMs": 0.16,
  "signatureMs": 0.16,
  "tickStringifyMs": 0.15,
  "tickBytes": 183431,
  "opsTickMs": 0.007,
  "opsTickBytes": 1356
}
```

## KR verdict

| KR | Target | Result | Verdict |
|----|--------|--------|---------|
| KR1 stream bytes/tick | ≥90%↓ | 184,227 B → 557 B (**99.7%↓**) | **MET** |
| KR2 tick CPU | ≥80%↓ | 0.78 ms → 0.007 ms (**99.1%↓**) | **MET** |
| KR3 cold open | ≥50%↓ | with tail-read: 11 → 2.6 ms (**76%↓** @3k); 19.8 → 2.8 ms (**86%↓** @10k) | **MET** (after funded tail-read follow-up) |
| KR4 re-render scope | affected row only | live chat already virtualized (LegendList, 13 DOM rows @2.5k entries, browser-verified); ops path keeps untouched-entry refs stable; share page gains content-visibility | **MET** (live path) |

KR3 history: after the LRU + window-clone change alone, first-open only
improved 5–43% (full JSONL read+parse dominated) — the `pointless` flag was
raised and the human funded the deferred tail-read in the same branch.
Tail-read (byte-slice storage APIs + `readTranscriptTail` + `byte:` cursors,
falling back to full parse whenever slice APIs are absent) landed KR3 at
76–86% reduction. Cross-page `context_window_updated` coalescing is kept
exact via a sentinel read of the newer page's first line.

Reading (baseline):
- **KR1 basis:** every broadcast tick re-sends ~184 KB per subscriber (the
  full 200-message window) even when only one entry changed. At the 16 ms
  coalescing floor that is up to ~11 MB/s per subscriber during streaming.
  Real sessions with large tool results (file reads, diffs) scale this
  window linearly with entry size.
- **KR2 basis:** derive+signature+stringify ≈ 0.6–0.8 ms per tick per
  subscriber on synthetic 1 KB entries; dominated by window size, so real
  MB-scale windows cost proportionally more. The ops path removes the
  per-tick window traversal entirely.
- **KR3 basis:** cold open 11–20 ms at 3.4–11 MB JSONL on a warm-FS dev box;
  the per-switch full re-read (single-chat cache) is the recurring cost the
  LRU removes.

---

## 2026-08-10 — the numbers above were measured on a fixture with no tail

Every number in this document predating this section was produced by a
`long-session-bench.ts` whose entries were all the same size
(`"lorem ipsum dolor sit amet ".repeat(40)`, ~1 KB). Re-measured against the
real corpus (last 200 entries of each of the 25 largest transcripts in a real
store, n=5000):

| | old fixture | real corpus |
|---|---|---|
| median entry | ~1.16 KB | 1.74 KB |
| p95 entry | ~1.16 KB | **18.8 KB** |
| p99 entry | ~1.16 KB | **212.6 KB** |
| largest entry | ~1.16 KB | **898.8 KB** |
| 200-entry window | 178 KB (fixed) | 0.47 MB – **3.89 MB** |

The median was within 2x, which is why the fixture looked plausible. The
**tail** was the part that was missing, and the tail is the whole problem.

Two conclusions in this document were wrong as a result:

- **`tickDeriveMs` 0.09 ms** — on the real distribution the same path costs
  **~17.5 ms** per tick. A ~190x underestimate. Confirmed present on `main`
  before any 2026-08 change, so this is a measurement error, not a regression.
- **The 200-entry window needs no byte bound** — the design (§4) bounded
  chat-open by tail-reading and by widening the LRU, both entry-count based. A
  window that cannot vary in weight cannot motivate a byte cap. In production
  it varies by 8x.

The KR1 basis note already said the risk out loud — "real sessions with large
tool results (file reads, diffs) scale this window linearly with entry size" —
and that insight was correctly applied to the streaming tick (op-log delta,
184 KB → 557 B). It was never applied to the FIRST page, because the fixture
could not produce the failure.

### What changed

`scripts/perf/entry-fixture.ts` now samples entry sizes from the measured
distribution (seeded, deterministic) and emits fat draws as `tool_result` to
keep the kind/size correlation. `--uniform` replays the old fixture so the
numbers above stay reproducible; it is not a basis for judging a change.

`scripts/perf/entry-fixture.test.ts` pins the SHAPE — median, p95, the
p95/p50 ratio, and that a 200-entry window weighs over 1 MB. Verified to fail
on the legacy generator (ratio 1.00, window 177,737 B). Flattening the
generator back toward one-size-per-entry now breaks the build instead of
quietly re-arming this blind spot.

### Post byte-cap numbers (same realistic fixture, 3000 entries)

| metric | before byte cap | after |
|---|---|---|
| first page entries | 200 | 73 |
| first page bytes | 3,146,581 | **1,014,638** |
| tickBytes (legacy full-snapshot path) | 3,149,099 | **1,017,156** |
| signatureMs | 0.62 | **0.16** |
| tickStringifyMs | 0.54 | **0.15** |
| coldOpenMs | 24.7 | 29.7 |

Cold open pays ~5 ms to measure the budget. `tickDeriveMs` (~17.5 ms) is
untouched by the byte cap and is the largest remaining item on this path.
