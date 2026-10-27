import type { MouseEvent as ReactMouseEvent } from "react"
import type { DomPort } from "../ports/domPort"

export function openContextMenuFromButton(
  event: Pick<ReactMouseEvent<HTMLButtonElement>, "currentTarget" | "preventDefault" | "stopPropagation">,
  dom: DomPort,
  target: EventTarget | null = event.currentTarget,
): void {
  event.preventDefault()
  event.stopPropagation()
  if (!target) return
  const rect = event.currentTarget.getBoundingClientRect()
  dom.dispatchContextMenuEvent(target, rect.left + rect.width / 2, rect.bottom)
}
