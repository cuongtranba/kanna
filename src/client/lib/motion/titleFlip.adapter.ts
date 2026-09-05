import { animate } from "animejs"
import { MOTION_DURATION, MOTION_EASE, prefersReducedMotion } from "."


const LOOKUP_TIMEOUT_MS = 400
const CLONE_MAX_MS = 800

export interface TitleFlipPorts {
  readonly root?: Document
  readonly now?: () => number
  readonly raf?: (callback: () => void) => void
}

function titleWithin(root: Document, attribute: string, value: string): HTMLElement | null {
  for (const element of root.querySelectorAll(`[${attribute}]`)) {
    if (element.getAttribute(attribute) !== value) continue
    return element.querySelector<HTMLElement>("span.truncate")
  }
  return null
}

export async function flyChatTitleToTab(
  chatId: string,
  ports: TitleFlipPorts = {},
): Promise<void> {
  try {
    await runCarry(chatId, ports)
  } catch {
  }
}

async function runCarry(chatId: string, ports: TitleFlipPorts): Promise<void> {
  const root = ports.root ?? globalThis.document
  if (!root?.body) return
  if (prefersReducedMotion()) return

  const ends = await waitForBothEnds(root, chatId, ports)
  if (!ends) return

  const { from, to, text } = ends
  const clone = root.createElement("span")
  clone.textContent = text
  clone.setAttribute("aria-hidden", "true")
  clone.style.cssText = [
    "position:fixed",
    `left:${from.left}px`,
    `top:${from.top}px`,
    "margin:0",
    "white-space:nowrap",
    "pointer-events:none",
    "z-index:60",
  ].join(";")

  const computed = root.defaultView?.getComputedStyle(ends.fromElement)
  if (computed) {
    clone.style.font = computed.font
    clone.style.color = computed.color
  }

  root.body.appendChild(clone)

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    clone.remove()
  }
  const guard = setTimeout(remove, CLONE_MAX_MS)

  try {
    await animate(clone, {
      x: to.left - from.left,
      y: to.top - from.top,
      opacity: [1, 0],
      duration: MOTION_DURATION.carry,
      ease: MOTION_EASE.arriving,
    })
  } finally {
    clearTimeout(guard)
    remove()
  }
}

interface FlipEnds {
  from: DOMRect
  to: DOMRect
  fromElement: HTMLElement
  text: string
}

async function waitForBothEnds(
  root: Document,
  chatId: string,
  ports: TitleFlipPorts,
): Promise<FlipEnds | null> {
  const now = ports.now ?? (() => Date.now())
  const raf = ports.raf ?? ((callback: () => void) => { requestAnimationFrame(callback) })
  const deadline = now() + LOOKUP_TIMEOUT_MS

  for (;;) {
    const fromElement = titleWithin(root, "data-chat-id", chatId)
    const toElement = titleWithin(root, "data-tab-id", chatId)
    if (fromElement && toElement) {
      const from = fromElement.getBoundingClientRect()
      const to = toElement.getBoundingClientRect()
      if (from.width > 0 && to.width > 0) {
        return { from, to, fromElement, text: fromElement.textContent ?? "" }
      }
    }
    if (now() >= deadline) return null
    await new Promise<void>((resolve) => { raf(resolve) })
  }
}
