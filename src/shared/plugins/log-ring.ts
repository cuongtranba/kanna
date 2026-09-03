export const PLUGIN_LOG_MAX_ENTRIES = 500
export const PLUGIN_LOG_MAX_LINE_BYTES = 16 * 1024

export type PluginLogEntry = {
  stream: "out" | "err"
  text: string
  at: number
}

/**
 * `TextEncoder`/`TextDecoder` rather than `Buffer`: this module sits in
 * `src/shared/**`, which the client bundle may import, and `Buffer` is a
 * Node global Vite does not polyfill (see `src/shared/plugins/paths.ts`,
 * same rationale).
 */
const LOG_TEXT_ENCODER = new TextEncoder()
const LOG_TEXT_DECODER = new TextDecoder()

/**
 * Truncates `text` to at most `maxBytes` UTF-8 bytes, never splitting a
 * multi-byte codepoint. A naive `text.slice(0, maxBytes)` counts JS UTF-16
 * code units, not encoded bytes, so it both over- and under-truncates
 * multi-byte text and can cut a surrogate pair or a multi-byte UTF-8
 * sequence in half. Encoding once and decoding the front `maxBytes` bytes
 * with `TextDecoder`'s default (non-fatal) mode instead drops any partial
 * trailing codepoint cleanly.
 */
function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = LOG_TEXT_ENCODER.encode(text)
  if (encoded.length <= maxBytes) return text
  return LOG_TEXT_DECODER.decode(encoded.subarray(0, maxBytes))
}

/**
 * A bounded, in-memory tail of a plugin's stdout/stderr, kept as discrete
 * structured entries rather than one flat string.
 *
 * This is deliberately NOT `OutputRing` (`src/server/claude-pty/output-ring.ts`):
 * that ring holds one flat string with a byte-capacity eviction, right for a
 * PTY scrollback where only the trailing byte window matters. This ring
 * holds line-oriented entries with a COUNT cap (`PLUGIN_LOG_MAX_ENTRIES`,
 * FIFO-evicted — same idiom as `MAX_SEEN_MESSAGE_IDS` elsewhere in this
 * repo) AND a per-entry BYTE cap (`PLUGIN_LOG_MAX_LINE_BYTES`), because a
 * plugin log UI lists individual lines rather than showing raw scrollback.
 * Do not merge the two implementations — the eviction unit differs.
 */
export function createPluginLogRing() {
  const entries: PluginLogEntry[] = []

  function append(entry: PluginLogEntry): void {
    const text = truncateToUtf8Bytes(entry.text, PLUGIN_LOG_MAX_LINE_BYTES)
    entries.push(text === entry.text ? entry : { ...entry, text })
    if (entries.length > PLUGIN_LOG_MAX_ENTRIES) {
      entries.splice(0, entries.length - PLUGIN_LOG_MAX_ENTRIES)
    }
  }

  function tail(): PluginLogEntry[] {
    return entries.slice()
  }

  return { append, tail }
}
