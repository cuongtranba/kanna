import type { PtyProcess } from "./pty-process"
import type { OutputRing } from "./output-ring"

export const TRUST_DIALOG_MARKER = "trust this folder"
export const TUI_READY_MARKER = "❯ "
export const TUI_READY_HARD_CAP_DEFAULT_MS = 3000

export interface WaitForTuiReadyOpts {
  hardCapMs?: number
  pollMs?: number
}

export async function waitForTuiReady(
  ring: OutputRing,
  opts: WaitForTuiReadyOpts = {},
): Promise<"marker" | "timeout"> {
  const hardCapMs = opts.hardCapMs ?? TUI_READY_HARD_CAP_DEFAULT_MS
  const pollMs = opts.pollMs ?? 50
  const start = Date.now()
  while (true) {
    if (ring.contains(TUI_READY_MARKER)) return "marker"
    if (Date.now() - start >= hardCapMs) return "timeout"
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

export async function dismissTrustDialogIfPresent(
  pty: PtyProcess,
  ring: OutputRing,
): Promise<boolean> {
  if (!ring.contains(TRUST_DIALOG_MARKER)) return false
  await pty.sendInput("\r")
  return true
}

export async function sendUserPrompt(pty: PtyProcess, text: string): Promise<void> {
  await pty.sendInput(text + "\r")
}

export async function sendExitCommand(pty: PtyProcess): Promise<void> {
  await pty.sendInput("/exit\r")
}
