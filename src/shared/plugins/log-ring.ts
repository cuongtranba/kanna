export const PLUGIN_LOG_MAX_ENTRIES = 500
export const PLUGIN_LOG_MAX_LINE_BYTES = 16 * 1024

export type PluginLogEntry = {
  stream: "out" | "err"
  text: string
  at: number
}

const LOG_TEXT_ENCODER = new TextEncoder()
const LOG_TEXT_DECODER = new TextDecoder()

function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  const encoded = LOG_TEXT_ENCODER.encode(text)
  if (encoded.length <= maxBytes) return text
  return LOG_TEXT_DECODER.decode(encoded.subarray(0, maxBytes))
}

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
