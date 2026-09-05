import "./setupHappyDom"
import { type ReactElement } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"

const LOOP_PATTERNS = [
  /Maximum update depth exceeded/i,
  /result of getSnapshot should be cached/i,
]

function registerTeardown(teardown: () => void): () => void {
  const teardowns = (globalThis as { __kannaDomTeardowns?: Set<() => void> }).__kannaDomTeardowns
  teardowns?.add(teardown)
  return () => {
    teardowns?.delete(teardown)
  }
}

export interface LoopCheckResult {
  errors: string[]
  loopWarnings: string[]
  thrown: unknown
  cleanup: () => Promise<void>
}

export async function renderForLoopCheck(element: ReactElement): Promise<LoopCheckResult> {
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => (typeof a === "string" ? a : (a as Error)?.message ?? String(a))).join(" "))
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  let torndown = false
  const teardown = () => {
    if (torndown) return
    torndown = true
    act(() => {
      root.unmount()
    })
    container.remove()
  }
  const unregister = registerTeardown(teardown)
  let thrown: unknown = null
  try {
    await act(async () => {
      root.render(element)
    })
  } catch (error) {
    thrown = error
  } finally {
    console.error = originalError
  }

  const errorMessage = thrown instanceof Error ? thrown.message : String(thrown ?? "")
  const loopWarnings = errors.filter((msg) => LOOP_PATTERNS.some((re) => re.test(msg)))
  if (thrown && LOOP_PATTERNS.some((re) => re.test(errorMessage))) {
    loopWarnings.push(errorMessage)
  }

  return {
    errors,
    loopWarnings,
    thrown,
    cleanup: async () => {
      if (torndown) return
      torndown = true
      unregister()
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}
