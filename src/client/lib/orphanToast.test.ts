import { describe, test, expect, mock, beforeEach } from "bun:test"

// ---------------------------------------------------------------------------
// Stub sonner's `toast` before importing orphanToast so the module picks up
// the stub at import time.
// ---------------------------------------------------------------------------

const toastCalls: Array<{ message: string; opts: unknown }> = []
const toastStub = mock((message: string, opts: unknown) => {
  toastCalls.push({ message, opts })
})

mock.module("sonner", () => ({ toast: toastStub }))

// Stub the backgroundTasksStore's openDialog
const openDialogCalls: number[] = []
mock.module("../stores/backgroundTasksStore", () => ({
  useBackgroundTasksStore: {
    getState: () => ({
      openDialog: () => { openDialogCalls.push(Date.now()) },
    }),
  },
}))

// Import AFTER mocks are set up
const { fireOrphanRecoveryToast } = await import("./orphanToast")

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fireOrphanRecoveryToast", () => {
  beforeEach(() => {
    toastCalls.length = 0
    openDialogCalls.length = 0
  })

  test("shows singular 'process' when count is 1", async () => {
    await fireOrphanRecoveryToast(1)
    expect(toastCalls).toHaveLength(1)
    expect(toastCalls[0]?.message).toBe("1 process survived restart")
  })

  test("shows plural 'processes' when count is 3", async () => {
    await fireOrphanRecoveryToast(3)
    expect(toastCalls).toHaveLength(1)
    expect(toastCalls[0]?.message).toBe("3 processes survived restart")
  })

  test("includes description with keyboard shortcut", async () => {
    await fireOrphanRecoveryToast(2)
    const opts = toastCalls[0]?.opts as { description?: string }
    expect(opts?.description).toContain("⌘⇧B")
  })

  test("action label is 'Review'", async () => {
    await fireOrphanRecoveryToast(2)
    const opts = toastCalls[0]?.opts as { action?: { label: string; onClick: () => void } }
    expect(opts?.action?.label).toBe("Review")
  })

  test("action onClick calls openDialog", async () => {
    await fireOrphanRecoveryToast(1)
    const opts = toastCalls[0]?.opts as { action?: { label: string; onClick: () => void } }
    expect(openDialogCalls).toHaveLength(0)
    opts?.action?.onClick()
    expect(openDialogCalls).toHaveLength(1)
  })

  test("second call still fires the toast (session-once guard is caller-owned)", async () => {
    await fireOrphanRecoveryToast(1)
    await fireOrphanRecoveryToast(1)
    expect(toastCalls).toHaveLength(2)
  })
})
