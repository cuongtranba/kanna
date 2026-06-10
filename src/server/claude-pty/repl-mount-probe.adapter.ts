import { readFile } from "node:fs/promises"

/**
 * Substring claude's `--debug` logging writes once the interactive REPL input
 * box mounts (`[REPL:mount] REPL mounted, disabled=false`). Spike against
 * claude 2.1.170 showed this line lands ~59 ms BEFORE the `❯ ` glyph and is
 * dialog-immune (trust / dev-channels dialogs do not emit it). Used ONLY to
 * corroborate the output-ring glyph ready signal — never an event source.
 */
export const REPL_MOUNT_MARKER = "[REPL:mount] REPL mounted"

/**
 * Read a claude `--debug-file` log and report whether the REPL-mount marker
 * has appeared. Observe-only: a missing or unreadable file resolves to `false`
 * (the corroboration is non-authoritative — the ring glyph stays primary).
 */
export async function readReplMounted(debugFilePath: string): Promise<boolean> {
  try {
    const text = await readFile(debugFilePath, "utf8")
    return text.includes(REPL_MOUNT_MARKER)
  } catch {
    return false
  }
}
