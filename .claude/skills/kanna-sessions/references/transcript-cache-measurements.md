# Transcript cache measurements

Why `TranscriptCache` evicts an oversized entry instead of keeping it, and why the
memory ceiling cannot be raised.

Measured on a larger corpus (1.0 GB across 262 chats), the largest transcript
was **96 MB / 36k entries, 524 MB peak RSS** to parse (5.4x). That is why an
oversized entry is evicted rather than kept: the hot paths (history primer,
proactive-compact trigger, subagent scope primer) already read the tail when
a transcript is not cached. **pm2 7.0.3 silently clamps `max_memory_restart`
at 2^31** (`"3G"` and `"4G"` both resolve to `2147483648`), so raising the
ceiling is not available — only lowering RSS is.
