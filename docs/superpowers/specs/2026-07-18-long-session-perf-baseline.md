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

Reading:
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
