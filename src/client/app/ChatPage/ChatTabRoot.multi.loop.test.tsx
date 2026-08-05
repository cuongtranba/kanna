/**
 * Proof test: two ChatTabRoot instances mounted simultaneously.
 *
 * Verifies:
 *  1. No render loops when two tabs are mounted side-by-side (React error #185
 *     / "getSnapshot should be cached" both checked).
 *  2. Each tab has an INDEPENDENT ChatTabScopedStore — writing to tab A does
 *     not affect tab B, and vice-versa.
 *
 * This is the oracle proof required by scripts/verify-session-tabs.sh.
 */
import { describe, expect, test } from "bun:test"
import { useEffect } from "react"
import type { StoreApi } from "zustand"
import { ChatTabRoot } from "./ChatTabRoot"
import { ChatTabScopedStore, type ChatTabScopedState } from "../../stores/chatTabScopedStore"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"

// ─── Capture helper (mirrors createScopedStore.test.tsx pattern) ─────────────

/** Calls `onApi` from a stable useEffect — avoids react-hooks/globals lint */
function CaptureApi({
  onApi,
}: {
  onApi: (api: StoreApi<ChatTabScopedState>) => void
}) {
  const api = ChatTabScopedStore.useScopedStoreApi()
  useEffect(() => {
    onApi(api)
  }, [api, onApi])
  return null
}

// ─── Read-only field consumers (for render-loop tests) ────────────────────────

function ToolGroupConsumer({ label }: { label: string }) {
  const expanded = ChatTabScopedStore.useScopedStore((s) => s.toolGroupExpanded)
  const keys = Object.keys(expanded)
  return <span data-label={label} data-count={keys.length}>{keys.join(",")}</span>
}

function ScrollFlagConsumer({ label }: { label: string }) {
  const show = ChatTabScopedStore.useScopedStore((s) => s.showScrollToBottom)
  return <span data-label={label} data-show={String(show)} />
}

function InputHeightConsumer({ label }: { label: string }) {
  const h = ChatTabScopedStore.useScopedStore((s) => s.inputHeight)
  return <span data-label={label} data-height={h} />
}

// ─── Isolation tests ─────────────────────────────────────────────────────────

describe("ChatTabRoot — store isolation", () => {
  test("two Provider instances are independent (toolGroupExpanded)", async () => {
    const apis: StoreApi<ChatTabScopedState>[] = []
    const push = (api: StoreApi<ChatTabScopedState>) => apis.push(api)

    // Stable callback refs avoid no-unstable-hook-fn-arg lint in CaptureApi's
    // useEffect dep array; we push them at render time so useCallback is hoisted
    // above the component tree using a plain module-level reference.
    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.thrown).toBeNull()
      expect(apis).toHaveLength(2)

      // Verify the two apis point to DIFFERENT store instances.
      expect(apis[0]).not.toBe(apis[1])

      // Mutate tab A — tab B must stay at default.
      apis[0]!.getState().setToolGroupExpanded((curr) => ({ ...curr, "tool-1": true }))
      expect(apis[0]!.getState().toolGroupExpanded).toEqual({ "tool-1": true })
      expect(apis[1]!.getState().toolGroupExpanded).toEqual({})
    } finally {
      await result.cleanup()
    }
  })

  test("two Provider instances are independent (inputHeight)", async () => {
    const apis: StoreApi<ChatTabScopedState>[] = []
    const push = (api: StoreApi<ChatTabScopedState>) => apis.push(api)

    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.thrown).toBeNull()
      expect(apis).toHaveLength(2)

      apis[0]!.getState().setInputHeight(999)
      expect(apis[0]!.getState().inputHeight).toBe(999)
      expect(apis[1]!.getState().inputHeight).toBe(148) // default unchanged
    } finally {
      await result.cleanup()
    }
  })

  test("two Provider instances are independent (sharePopoverOpen)", async () => {
    const apis: StoreApi<ChatTabScopedState>[] = []
    const push = (api: StoreApi<ChatTabScopedState>) => apis.push(api)

    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.thrown).toBeNull()
      expect(apis).toHaveLength(2)

      apis[0]!.getState().setSharePopoverOpen(true)
      expect(apis[0]!.getState().sharePopoverOpen).toBe(true)
      expect(apis[1]!.getState().sharePopoverOpen).toBe(false)
    } finally {
      await result.cleanup()
    }
  })

  test("two Provider instances are independent (currentText)", async () => {
    const apis: StoreApi<ChatTabScopedState>[] = []
    const push = (api: StoreApi<ChatTabScopedState>) => apis.push(api)

    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.thrown).toBeNull()
      expect(apis).toHaveLength(2)

      apis[0]!.getState().setCurrentText("hello from tab A")
      expect(apis[0]!.getState().currentText).toBe("hello from tab A")
      expect(apis[1]!.getState().currentText).toBe("")
    } finally {
      await result.cleanup()
    }
  })

  test("resetToolGroupExpanded only clears the owning tab", async () => {
    const apis: StoreApi<ChatTabScopedState>[] = []
    const push = (api: StoreApi<ChatTabScopedState>) => apis.push(api)

    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
        <ChatTabRoot><CaptureApi onApi={push} /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.thrown).toBeNull()
      expect(apis).toHaveLength(2)

      apis[0]!.getState().setToolGroupExpanded((curr) => ({ ...curr, "g1": true }))
      apis[1]!.getState().setToolGroupExpanded((curr) => ({ ...curr, "g2": true }))
      apis[0]!.getState().resetToolGroupExpanded()

      expect(apis[0]!.getState().toolGroupExpanded).toEqual({})
      expect(apis[1]!.getState().toolGroupExpanded).toEqual({ "g2": true })
    } finally {
      await result.cleanup()
    }
  })
})

// ─── Render-loop tests ────────────────────────────────────────────────────────

describe("ChatTabRoot — no render loops", () => {
  test("two chat tabs mounted side-by-side: no loop from toolGroupExpanded", async () => {
    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><ToolGroupConsumer label="a" /></ChatTabRoot>
        <ChatTabRoot><ToolGroupConsumer label="b" /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect(result.thrown).toBeNull()
    } finally {
      await result.cleanup()
    }
  })

  test("two chat tabs mounted side-by-side: no loop from showScrollToBottom", async () => {
    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><ScrollFlagConsumer label="a" /></ChatTabRoot>
        <ChatTabRoot><ScrollFlagConsumer label="b" /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect(result.thrown).toBeNull()
    } finally {
      await result.cleanup()
    }
  })

  test("two chat tabs mounted side-by-side: no loop from inputHeight", async () => {
    const result = await renderForLoopCheck(
      <>
        <ChatTabRoot><InputHeightConsumer label="a" /></ChatTabRoot>
        <ChatTabRoot><InputHeightConsumer label="b" /></ChatTabRoot>
      </>,
    )
    try {
      expect(result.loopWarnings).toEqual([])
      expect(result.thrown).toBeNull()
    } finally {
      await result.cleanup()
    }
  })
})
