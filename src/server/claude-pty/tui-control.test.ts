import { describe, expect, test } from "bun:test"
import {
  sendUserPrompt,
  sendExitCommand,
  dismissTrustDialogIfPresent,
  waitForTuiReady,
  TRUST_DIALOG_MARKER,
  TUI_READY_MARKER,
} from "./tui-control"
import { OutputRing } from "./output-ring"
import type { PtyProcess } from "./pty-process"

function fakePty(): PtyProcess & { sent: string[] } {
  const sent: string[] = []
  return {
    sent,
    async sendInput(data: string) { sent.push(data) },
    resize() { /* noop */ },
    exited: new Promise<number>(() => { /* never */ }),
    close() { /* noop */ },
  } as PtyProcess & { sent: string[] }
}

describe("sendUserPrompt", () => {
  test("writes text + carriage return", async () => {
    const pty = fakePty()
    await sendUserPrompt(pty, "say hi")
    expect(pty.sent).toEqual(["say hi\r"])
  })

  test("empty string still sends carriage return", async () => {
    const pty = fakePty()
    await sendUserPrompt(pty, "")
    expect(pty.sent).toEqual(["\r"])
  })
})

describe("sendExitCommand", () => {
  test("writes /exit + carriage return", async () => {
    const pty = fakePty()
    await sendExitCommand(pty)
    expect(pty.sent).toEqual(["/exit\r"])
  })
})

describe("dismissTrustDialogIfPresent", () => {
  test("sends carriage return when ringbuf contains trust marker", async () => {
    const pty = fakePty()
    const ring = new OutputRing()
    ring.append("Quick safety check: Do you trust this folder? trust this folder")
    const dismissed = await dismissTrustDialogIfPresent(pty, ring)
    expect(dismissed).toBe(true)
    expect(pty.sent).toEqual(["\r"])
  })

  test("does nothing when ringbuf lacks trust marker", async () => {
    const pty = fakePty()
    const ring = new OutputRing()
    ring.append("Welcome back c!")
    const dismissed = await dismissTrustDialogIfPresent(pty, ring)
    expect(dismissed).toBe(false)
    expect(pty.sent).toEqual([])
  })

  test("exported TRUST_DIALOG_MARKER is the substring matched", () => {
    expect(TRUST_DIALOG_MARKER).toBe("trust this folder")
  })
})

describe("waitForTuiReady", () => {
  test("returns 'marker' when ringbuf already contains the input-box marker", async () => {
    const ring = new OutputRing()
    ring.append("❯ ")
    const result = await waitForTuiReady(ring, { hardCapMs: 1000, pollMs: 10 })
    expect(result).toBe("marker")
  })

  test("returns 'timeout' when no marker appears within hardCapMs", async () => {
    const ring = new OutputRing()
    const result = await waitForTuiReady(ring, { hardCapMs: 200, pollMs: 10 })
    expect(result).toBe("timeout")
  })

  test("polls until marker appears", async () => {
    const ring = new OutputRing()
    setTimeout(() => ring.append("❯ "), 50)
    const start = Date.now()
    const result = await waitForTuiReady(ring, { hardCapMs: 1000, pollMs: 10 })
    const elapsed = Date.now() - start
    expect(result).toBe("marker")
    expect(elapsed).toBeLessThan(300)
  })

  test("exported TUI_READY_MARKER is the input-box prompt", () => {
    expect(TUI_READY_MARKER).toBe("❯ ")
  })
})
