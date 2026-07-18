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
