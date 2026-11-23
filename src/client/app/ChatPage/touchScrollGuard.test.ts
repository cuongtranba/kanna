import { expect, test } from "vite-plus/test"
import { makeFakeTimerPort } from "../../adapters/testing/makeFakePorts"
import { installTouchScrollGuard } from "./touchScrollGuard"

const HOLD_LIMIT_PX = 600

function mountList() {
  const scrollNode = document.createElement("div")
  const content = document.createElement("div")
  content.className = "legend-list-content-container"
  scrollNode.append(content)
  document.body.append(scrollNode)
  const scrolled: number[] = []
  scrollNode.scrollBy = (first?: ScrollToOptions | number, second?: number) => {
    scrolled.push(typeof first === "number" ? second ?? 0 : first?.top ?? 0)
  }
  return { scrollNode, content, scrolled }
}

test("a correction during a touch gesture holds the content in place and scrolls once the gesture settles", () => {
  const timer = makeFakeTimerPort()
  const { scrollNode, content, scrolled } = mountList()
  const dispose = installTouchScrollGuard(scrollNode, timer, HOLD_LIMIT_PX)

  scrollNode.dispatchEvent(new Event("touchstart"))
  scrollNode.scrollBy({ top: 120 })
  scrollNode.scrollBy(0, -20)

  expect(scrolled).toEqual([])
  expect(content.style.transform).toBe("translateY(-100px)")

  scrollNode.dispatchEvent(new Event("touchend"))
  timer.flushTimeouts()

  expect(scrolled).toEqual([100])
  expect(content.style.transform).toBe("")
  dispose()
})

test("a correction outside a touch gesture scrolls immediately", () => {
  const timer = makeFakeTimerPort()
  const { scrollNode, content, scrolled } = mountList()
  const dispose = installTouchScrollGuard(scrollNode, timer, HOLD_LIMIT_PX)

  scrollNode.scrollBy({ top: 48 })

  expect(scrolled).toEqual([48])
  expect(content.style.transform).toBe("")
  dispose()
})

test("disposing mid-gesture releases the held correction instead of leaving the content offset", () => {
  const timer = makeFakeTimerPort()
  const { scrollNode, content, scrolled } = mountList()
  const dispose = installTouchScrollGuard(scrollNode, timer, HOLD_LIMIT_PX)

  scrollNode.dispatchEvent(new Event("touchstart"))
  scrollNode.scrollBy({ top: 64 })
  dispose()

  expect(content.style.transform).toBe("")
  expect(scrolled).toEqual([64])
})

test("a correction too large to hold lands immediately so the reader never sees unrendered space", () => {
  const timer = makeFakeTimerPort()
  const { scrollNode, content, scrolled } = mountList()
  const dispose = installTouchScrollGuard(scrollNode, timer, HOLD_LIMIT_PX)

  scrollNode.dispatchEvent(new Event("touchstart"))
  scrollNode.scrollBy({ top: 200 })
  scrollNode.scrollBy({ top: 170_000 })

  expect(scrolled).toEqual([170_200])
  expect(content.style.transform).toBe("")
  dispose()
})
