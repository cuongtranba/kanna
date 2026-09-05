import { animate } from "animejs"
import { MOTION_DURATION, MOTION_EASE, prefersReducedMotion } from "."

/**
 * Beat 3's carry: the new chat's title flies from its sidebar row to the tab
 * that now holds it.
 *
 * This is what stops a new chat feeling like a page load — the eye follows one
 * object from the list it appeared in to the place it now lives, instead of
 * being asked to re-find it. Everything else in the sentence can be done with
 * a class; this one cannot, because it needs two live rects that only exist
 * once both surfaces have rendered.
 *
 * **An adapter, because it is raw DOM.** Measuring rects, appending a clone and
 * removing it are exactly the side effects `src/client/**` seals, and the
 * `.adapter.ts` suffix is the sanctioned place for them.
 *
 * **The handoff's destination was wrong for this repo.** It specifies a flight
 * to "the navbar title"; Kanna has no navbar title — a chat's name is rendered
 * by the pane TAB STRIP. The behaviour is the handoff's, the target is what
 * actually draws the name today.
 *
 * **Every failure is a no-op, and the clone is removed on every path.** A
 * floating orphan of duplicated text over the UI would be far worse than a
 * missing flourish, so the removal is owned by a `finally`-shaped guard and by
 * a hard timeout that does not depend on the animation completing.
 */

/** How long to keep looking for both ends before giving up silently. */
const LOOKUP_TIMEOUT_MS = 400
/** Ceiling on the clone's life, however the animation ends. */
const CLONE_MAX_MS = 800

export interface TitleFlipPorts {
  /** Injected for tests; the real one is the live document. */
  readonly root?: Document
  readonly now?: () => number
  readonly raf?: (callback: () => void) => void
}

/**
 * Finds the element carrying `attribute="value"` WITHOUT interpolating the
 * value into a selector.
 *
 * Building `[data-chat-id="${id}"]` needs `CSS.escape`, and an escaped value
 * is still not guaranteed to parse — a chat id containing a quote produces a
 * selector some engines reject outright, which throws inside a call nobody
 * awaits. Reading the attribute back has no such surface and no escaping to
 * get wrong. The candidate set is one row or one tab per open chat.
 */
function titleWithin(root: Document, attribute: string, value: string): HTMLElement | null {
  for (const element of root.querySelectorAll(`[${attribute}]`)) {
    if (element.getAttribute(attribute) !== value) continue
    // The title is the only flex-1 truncating span in either surface, which
    // keeps this off the timestamp and the status mark beside it.
    return element.querySelector<HTMLElement>("span.truncate")
  }
  return null
}

/**
 * Runs the carry for `chatId`. Resolves when the clone is gone — which is
 * guaranteed, whether or not the animation ever ran.
 */
export async function flyChatTitleToTab(
  chatId: string,
  ports: TitleFlipPorts = {},
): Promise<void> {
  // Never rejects. The one caller launches this detached (`void …`) so that a
  // chat cannot fail to open because a flourish could not find its two ends;
  // a rejection there would surface as an unhandled promise, which is a real
  // error report for a purely cosmetic path.
  try {
    await runCarry(chatId, ports)
  } catch {
    // A carry that cannot run is a carry that does not run.
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
  // The clone's life is bounded independently of the animation. A tween that
  // never completes must not leave duplicated text floating over the app.
  const guard = setTimeout(remove, CLONE_MAX_MS)

  try {
    // anime.js's JSAnimation is thenable, so the tween is awaited directly.
    // `opacity` is legitimate here: the clone is a throwaway that must NOT be
    // visible at rest, so a frozen animation leaving it hidden is the safe
    // direction — the real title is untouched underneath the whole time.
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

/**
 * Both ends appear asynchronously — the row when the sidebar snapshot lands,
 * the tab when the route settles — so this polls a bounded number of frames
 * rather than assuming a single tick is enough. Giving up costs the flourish
 * and nothing else.
 */
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
      // A zero-size rect means the element is laid out but not painted yet;
      // flying to it would land the clone at the viewport origin.
      if (from.width > 0 && to.width > 0) {
        return { from, to, fromElement, text: fromElement.textContent ?? "" }
      }
    }
    if (now() >= deadline) return null
    await new Promise<void>((resolve) => { raf(resolve) })
  }
}
