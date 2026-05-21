import type { PtyProcess } from "./pty-process"
import type { OutputRing } from "./output-ring"

export const TRUST_DIALOG_MARKER = "trust this folder"
export const TUI_READY_MARKER = "❯ "
export const TUI_READY_HARD_CAP_DEFAULT_MS = 3000

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
}

export async function waitForTuiReady(
  ring: OutputRing,
  opts: WaitForTuiReadyOpts = {},
): Promise<"marker" | "timeout"> {
  const hardCapMs = opts.hardCapMs ?? TUI_READY_HARD_CAP_DEFAULT_MS
  const pollMs = opts.pollMs ?? 50
  const start = Date.now()
  while (true) {
    if (stripAnsi(ring.tail()).includes(TUI_READY_MARKER)) return "marker"
    if (Date.now() - start >= hardCapMs) return "timeout"
    await new Promise((r) => setTimeout(r, pollMs))
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

export interface WaitForTuiReadyWithTrustDismissOpts {
  hardCapMs?: number
  pollMs?: number
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
      if (stripAnsi(checkWindow).includes(TUI_READY_MARKER)) return "ready"
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return "timeout"
}

export async function sendUserPrompt(pty: PtyProcess, text: string): Promise<void> {
  // Bracketed paste (\x1b[200~...\x1b[201~) tells the TUI "this is pasted
  // text, do not interpret control chars" — then a separate \r is treated as
  // "submit". Combined `text + "\r"` is interpreted by claude's TUI input
  // handler as "newline within the input box", not "submit prompt", so the
  // prompt sits in the input area and the model never makes an API call.
  // Matches the canon/shannon reference impl: tmux paste-buffer + C-m.
  //
  // Multi-line pastes get collapsed by claude TUI into a "[Pasted text #N
  // +X lines]" reference; the TUI then needs a clear separation between
  // the paste-end marker and the Enter keystroke or the \r gets absorbed
  // into the paste buffer instead of submitting. 200 ms post-paste delay +
  // a second \r after another 50 ms covers both cases.
  await pty.sendInput(`\x1b[200~${text}\x1b[201~`)
  await new Promise((r) => setTimeout(r, 200))
  await pty.sendInput("\r")
}

export async function sendExitCommand(pty: PtyProcess): Promise<void> {
  await pty.sendInput("/exit\r")
}
