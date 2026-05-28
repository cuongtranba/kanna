import type { PtyProcess } from "./pty-process.adapter"
import type { OutputRing } from "./output-ring"

export const TRUST_DIALOG_MARKER = "trust this folder"
// DevChannelsDialog (from --dangerously-load-development-channels). Default
// Select option "I am using this for local development" — accept with \r.
export const DEV_CHANNELS_DIALOG_MARKER = "local channel development"
export const TUI_READY_MARKER = "❯ "
export const TUI_READY_HARD_CAP_DEFAULT_MS = 3000
// Quiet-period gate: after first ❯ marker hit, the TUI may still be in the
// middle of rendering (splash → cwd line → MCP spinner → input frame). The
// marker can leak from a transient render before Ink mounts the keyboard
// handler. Waiting for the output ring to stay quiet for this long after the
// marker is the cheapest proxy for "input handler attached and ready". Drops
// the race where the first prompt lands during splash and gets discarded.
export const TUI_READY_QUIET_DEFAULT_MS = 300

// Strip VT100/ANSI escape sequences and normalize non-breaking spaces so
// plain-text markers can be matched against raw PTY output. The TUI renders:
// - spaces as \x1b[1C (cursor-right-1) — replaced with regular space
// - the ❯ input prompt followed by U+00A0 (NBSP) — normalized to regular space
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

/**
 * After the ❯ marker first appears, wait until the ring stays the same size
 * for `quietMs` straight — that is the cheapest proxy for "TUI render queue
 * drained, Ink keyboard handler mounted". If the deadline is reached first,
 * return early (best-effort: we did see the marker). Polls every `pollMs`.
 */
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
  // Strip ANSI before matching: the TUI renders spaces as \x1b[1C so the
  // literal phrase "trust this folder" never appears in the raw ring bytes.
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

/**
 * Combined helper: polls for the TUI input-box marker ("❯ ") while
 * concurrently watching for the trust dialog. Dismisses the dialog once
 * (via \r) and keeps polling until the real input box appears.
 *
 * Use this instead of separate waitForTuiReady + dismissTrustDialogIfPresent
 * calls — the two-step approach races: the trust dialog blocks the input box,
 * so waitForTuiReady times out before the dialog is dismissed.
 */
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
  // After dismissing the trust dialog, only match the ready marker against
  // content added after the dismiss point — the trust dialog rendering itself
  // contains "❯\x1b[1C1. Yes,..." which strips to "❯ 1. Yes,..." and would
  // false-trigger the TUI_READY_MARKER check if the full ring were searched.
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
  while (Date.now() - start < hardCapMs) {
    const view = stripAnsi(ring.tail())
    if (!trustDone && view.includes(TRUST_DIALOG_MARKER)) {
      await pty.sendInput("\r")
      trustDone = true
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    if (!devDone && view.includes(DEV_CHANNELS_DIALOG_MARKER)) {
      await pty.sendInput("\r")
      devDone = true
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    if (view.includes(TUI_READY_MARKER) && (devDone || !view.includes(DEV_CHANNELS_DIALOG_MARKER))) {
      return "marker"
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return "timeout"
}

export interface SendUserPromptOpts {
  /**
   * Hard cap on how long to wait for the TUI to commit the bracketed
   * paste to its input box before sending Enter. Defaults to 2 s.
   */
  commitTimeoutMs?: number
  /** Poll interval while waiting for ring growth. Defaults to 10 ms. */
  pollMs?: number
}

export async function sendUserPrompt(
  pty: PtyProcess,
  ring: OutputRing,
  text: string,
  opts: SendUserPromptOpts = {},
): Promise<void> {
  // Bracketed paste (\x1b[200~...\x1b[201~) tells the TUI "this is pasted
  // text, do not interpret control chars" so newlines in `text` don't
  // submit prematurely. The follow-up \r is the actual "submit" key.
  //
  // The catch: claude's TUI processes bracketed paste asynchronously —
  // multi-line pastes get collapsed into a "[Pasted text #N +X lines]"
  // reference, and the input box rendering happens AFTER the paste-end
  // marker is consumed. If we send \r before that rendering completes,
  // the keystroke is absorbed into the still-open paste buffer instead
  // of being treated as submit. A fixed-time sleep here is a brittle
  // timing hack — system load, model effort settings, and PTY scheduling
  // all shift the window.
  //
  // Adaptive fix: snapshot the output ring length, write the paste,
  // then wait until the ring GROWS (i.e. the TUI rendered something in
  // response to the paste) before sending Enter. The grow signal is
  // deterministic — if it never arrives within commitTimeoutMs we fall
  // through and send Enter anyway, matching prior timeout behaviour.
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
