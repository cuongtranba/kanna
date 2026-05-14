import "./setupHappyDom"
import { type ReactElement } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const LOOP_PATTERNS = [
  /Maximum update depth exceeded/i,
  /result of getSnapshot should be cached/i,
]

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
  let root: Root | null = null
  let thrown: unknown = null
  try {
    await act(async () => {
      root = createRoot(container)
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
      await act(async () => {
        root?.unmount()
      })
      container.remove()
    },
  }
}
