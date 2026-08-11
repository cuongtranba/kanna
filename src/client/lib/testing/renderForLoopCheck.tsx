import "./setupHappyDom"
import { afterEach } from "bun:test"
import { type ReactElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const LOOP_PATTERNS = [
  /Maximum update depth exceeded/i,
  /result of getSnapshot should be cached/i,
]

/**
 * Mounted roots this helper still owns.
 *
 * The returned `cleanup` is easy to forget, and forgetting it leaves a LIVE
 * root behind in a process where the preload wipes `document.body` after every
 * test. The next commit that root makes then deletes a node the wipe already
 * took, which happy-dom refuses — from inside whatever unrelated test happens
 * to be running. Tearing down here makes the leak impossible instead of
 * detectable.
 */
const mounted = new Set<{ root: Root; container: HTMLDivElement }>()

afterEach(() => {
  for (const entry of mounted) {
    act(() => {
      entry.root.unmount()
    })
    entry.container.remove()
  }
  mounted.clear()
})

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
  const entry = { root, container }
  mounted.add(entry)
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
      if (!mounted.delete(entry)) return
      await act(async () => {
        root.unmount()
      })
      container.remove()
    },
  }
}
