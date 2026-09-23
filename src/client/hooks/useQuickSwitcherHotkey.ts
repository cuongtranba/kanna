import { useEffect } from "react"
import type { KeybindingsSnapshot } from "../../shared/types"
import { shouldToggleQuickSwitcher } from "../lib/quickSwitcher"
import { useQuickSwitcherStore } from "../stores/quickSwitcherStore"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export function useQuickSwitcherHotkey(
  keybindings: KeybindingsSnapshot | null,
  dom: DomPort = domAdapter,
): void {
  const toggleSwitcher = useQuickSwitcherStore((state) => state.toggleSwitcher)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!shouldToggleQuickSwitcher(keybindings, event)) return
      event.preventDefault()
      toggleSwitcher()
    }

    return dom.addWindowListener("keydown", handleKeyDown)
  }, [dom, keybindings, toggleSwitcher])
}
