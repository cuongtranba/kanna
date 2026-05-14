# Chat Heavy Message Load Perf — Learnings

**Session**: `20260514T091513Z-chat-heavy-message-load-perf`
**Branch**: `autoresearch/chat-heavy-message-load-perf`
**Commit**: `e7a53b5`

## Root Cause: deriveTimings defeats snapshot dedup

`pushSnapshots` in `ws-router.ts` uses `snapshotSignatures` Map to skip sending
snapshots that haven't changed. The signature was `JSON.stringify(envelope.snapshot)`.

`deriveTimings` (called inside `deriveChatSnapshot`) always sets:
- `timings.derivedAtMs = nowMs` (Date.now() — changes every millisecond)
- `timings.cumulativeMs.idle` — also time-varying

This made every chat snapshot JSON-unique, so every call to `broadcastSnapshots`
passed the dedup check and sent a full snapshot over WebSocket.

On a 7MB/1785-line chat, `broadcastSnapshots` is triggered 12+ times per page load
(via 7+ active claude agent processes), sending ~9MB total vs the 685KB actually needed.

## Fix

`getStableChatSnapshotSignature`: strip `runtime.timings` before computing the
dedup signature. Same message content → same signature → dedup fires → skip send.

```typescript
function getStableChatSnapshotSignature(snapshot): string {
  if (snapshot.type === "chat" && snapshot.data?.runtime) {
    const { timings: _t, ...stableRuntime } = snapshot.data.runtime
    return JSON.stringify({ type: snapshot.type, data: { ...snapshot.data, runtime: stableRuntime } })
  }
  return JSON.stringify(snapshot)
}
```

## Results

| Metric | Baseline | With Fix | Delta |
|--------|----------|----------|-------|
| WS bytes (2s window) | 9,004,516 | 2,008,875 | **-78%** |
| WS frames (2s window) | 34 | 24 | -29% |
| TTFR (median) | 325ms | 390ms | ~noise |

TTFR improvement was not significant — the fix primarily reduces redundant
post-render traffic, not first-render latency.

## Other Findings

- `loadTranscriptFromDisk` (7MB JSONL): ~16.5ms — not a bottleneck
- `DEFAULT_CHAT_RECENT_LIMIT = 200`: server sends last 200 messages in initial snapshot, not all 1785
- LegendList renders only viewport rows (`[data-index]` = ~31 visible, not total)
- React 18 automatic batching: repeated WS messages DO batch state updates
- `cachedTranscript`: single-entry server cache — works fine for single active chat

## Follow-up Hypotheses (not yet tested)

1. **Client-side**: `buildTranscriptMessageRenderStates` does 3×O(n) passes — memoize
2. **Client-side**: `computeStableResolvedTranscriptRows` builds new Map per update — could be incremental
3. **Server-side**: `broadcastSnapshots` called 12+ times per page load — coalesce with debounce
