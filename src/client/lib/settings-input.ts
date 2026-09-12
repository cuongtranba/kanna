import type { KeyboardEvent } from "react"

export function handleTextInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  commit: () => void,
) {
  if (event.key !== "Enter") return
  commit()
  event.currentTarget.blur()
}
