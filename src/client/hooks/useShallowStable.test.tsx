import { describe, expect, test } from "vite-plus/test"
import { act, useState } from "react"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { useShallowStable } from "./useShallowStable"

interface Fields {
  first: () => void
  second: () => void
}

const SHARED_FIRST = () => undefined
const OTHER_SECOND = () => undefined
const SHARED_SECOND = () => undefined

describe("useShallowStable", () => {
  test("keeps the previous object while every field keeps its identity and swaps it when one changes", async () => {
    const seen: Fields[] = []

    function Probe({ second }: { second: () => void }) {
      seen.push(useShallowStable<Fields>({ first: SHARED_FIRST, second }))
      return null
    }

    function Parent() {
      const [second, setSecond] = useState<() => void>(() => SHARED_SECOND)
      return (
        <>
          <button id="same" onClick={() => setSecond(() => SHARED_SECOND)}>same</button>
          <button id="swap" onClick={() => setSecond(() => OTHER_SECOND)}>swap</button>
          <Probe second={second} />
        </>
      )
    }

    const rendered = await renderForLoopCheck(<Parent />)
    try {
      const click = async (id: string) => {
        await act(async () => {
          document.getElementById(id)?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
      }
      await click("same")
      await click("swap")
      const distinct = seen.filter((value, index) => seen.indexOf(value) === index)
      expect(distinct).toHaveLength(2)
      expect(distinct[0]?.second).toBe(SHARED_SECOND)
      expect(distinct[1]?.second).toBe(OTHER_SECOND)
    } finally {
      await rendered.cleanup()
    }
  })
})
