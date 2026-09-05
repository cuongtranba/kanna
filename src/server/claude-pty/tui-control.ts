import type { PtyProcess } from "./pty-process.adapter"
import type { OutputRing } from "./output-ring"

export const TRUST_DIALOG_MARKER = "trust this folder"
export const DEV_CHANNELS_DIALOG_MARKER = "local channel development"
export const TUI_READY_MARKER = "❯ "
export const TUI_READY_HARD_CAP_DEFAULT_MS = 3000
export const TUI_READY_QUIET_DEFAULT_MS = 300

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, " ")
    .replace(/\x1b./g, "")
    .replace(/\u00a0/g, " ")
}

export interface WaitForTuiReadyOpts {
  hardCapMs?: number
  pollMs?: number
  quietPeriodMs?: number
}

export async function waitForTuiReady(
  ring: OutputRing,
  opts: WaitForTuiReadyOpts = {},
): Promise<"marker" | "timeout"> {
  const hardCapMs = opts.hardCapMs ?? TUI_READY_HARD_CAP_DEFAULT_MS
  const pollMs = opts.pollMs ?? 50
  const quietPeriodMs = opts.quietPeriodMs ?? TUI_READY_QUIET_DEFAULT_MS
  const start = Date.now()
  while (true) {
    if (stripAnsi(ring.tail()).includes(TUI_READY_MARKER)) {
      await waitForRingQuiet(ring, { quietMs: quietPeriodMs, pollMs, deadline: start + hardCapMs })
      return "marker"
    }
    if (Date.now() - start >= hardCapMs) return "timeout"
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

async function waitForRingQuiet(
  ring: OutputRing,
  opts: { quietMs: number; pollMs: number; deadline: number },
): Promise<void> {
  if (opts.quietMs <= 0) return
  let lastLength = ring.tail().length
  let quietStart = Date.now()
  while (Date.now() - quietStart < opts.quietMs) {
    if (Date.now() >= opts.deadline) return
    await new Promise((r) => setTimeout(r, opts.pollMs))
    const currentLength = ring.tail().length
    if (currentLength !== lastLength) {
      lastLength = currentLength
      quietStart = Date.now()
    }
  }
}

export async function dismissTrustDialogIfPresent(
  pty: PtyProcess,
  ring: OutputRing,
): Promise<boolean> {
  if (!stripAnsi(ring.tail()).includes(TRUST_DIALOG_MARKER)) return false
  await pty.sendInput("\r")
  return true
}

export async function dismissDevChannelsDialogIfPresent(
  pty: PtyProcess,
  ring: OutputRing,
): Promise<boolean> {
  if (!stripAnsi(ring.tail()).includes(DEV_CHANNELS_DIALOG_MARKER)) return false
  await pty.sendInput("\r")
  return true
}

export interface WaitForTuiReadyWithTrustDismissOpts {
  hardCapMs?: number
  pollMs?: number
  quietPeriodMs?: number
}

export async function waitForTuiReadyWithTrustDismiss(
  pty: PtyProcess,
  ring: OutputRing,
  opts: WaitForTuiReadyWithTrustDismissOpts = {},
): Promise<"ready" | "timeout"> {
  const hardCapMs = opts.hardCapMs ?? 15_000
  const pollMs = opts.pollMs ?? 50
  const quietPeriodMs = opts.quietPeriodMs ?? TUI_READY_QUIET_DEFAULT_MS
  const start = Date.now()
  let trustDismissed = false
  let postDismissOffset = 0

  while (Date.now() - start < hardCapMs) {
    const raw = ring.tail()
    if (!trustDismissed && stripAnsi(raw).includes(TRUST_DIALOG_MARKER)) {
      postDismissOffset = raw.length
      await pty.sendInput("\r")
      trustDismissed = true
    } else {
      const checkWindow = trustDismissed ? raw.slice(postDismissOffset) : raw
      if (stripAnsi(checkWindow).includes(TUI_READY_MARKER)) {
        await waitForRingQuiet(ring, { quietMs: quietPeriodMs, pollMs, deadline: start + hardCapMs })
        return "ready"
      }
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return "timeout"
}

export async function waitForTuiReadyDismissingDialogs(
  pty: PtyProcess,
  ring: OutputRing,
  opts: { hardCapMs?: number; pollMs?: number } = {},
): Promise<"marker" | "timeout"> {
  const hardCapMs = opts.hardCapMs ?? TUI_READY_HARD_CAP_DEFAULT_MS + 5_000
  const pollMs = opts.pollMs ?? 50
  const start = Date.now()
  let trustDone = false
  let devDone = false
  let postDismissOffset = 0
  while (Date.now() - start < hardCapMs) {
    const raw = ring.tail()
    const view = stripAnsi(raw)
    if (!trustDone && view.includes(TRUST_DIALOG_MARKER)) {
      postDismissOffset = raw.length
      await pty.sendInput("\r")
      trustDone = true
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    if (!devDone && view.includes(DEV_CHANNELS_DIALOG_MARKER)) {
      postDismissOffset = raw.length
      await pty.sendInput("\r")
      devDone = true
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    if (devDone && stripAnsi(raw.slice(postDismissOffset)).includes(TUI_READY_MARKER)) {
      return "marker"
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return "timeout"
}

export interface SendUserPromptOpts {
  commitTimeoutMs?: number
  pollMs?: number
}

export async function sendUserPrompt(
  pty: PtyProcess,
  ring: OutputRing,
  text: string,
  opts: SendUserPromptOpts = {},
): Promise<void> {
  const commitTimeoutMs = opts.commitTimeoutMs ?? 2_000
  const pollMs = opts.pollMs ?? 10
  const baseline = ring.tail().length
  await pty.sendInput(`\x1b[200~${text}\x1b[201~`)
  const deadline = Date.now() + commitTimeoutMs
  while (Date.now() < deadline) {
    if (ring.tail().length > baseline) break
    await new Promise((r) => setTimeout(r, pollMs))
  }
  await pty.sendInput("\r")
}

export async function sendExitCommand(pty: PtyProcess): Promise<void> {
  await pty.sendInput("/exit\r")
}
