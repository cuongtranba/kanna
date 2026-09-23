import { useEffect } from "react"
import type { KeybindingsSnapshot } from "../../shared/types"
import { bindingModifiersReleased } from "../lib/keybindings"
import {
  focusedPaneOf,
  matchTabSwitcherTrigger,
  orderTabsByRecency,
  shouldShowTabJumpHints,
  tabJumpDigit,
  tabJumpTarget,
  type TabSwitcherTrigger,
} from "../lib/tabSwitcher"
import { usePaneLayoutStore } from "../stores/paneLayoutStore"
import { useTabSwitcherStore } from "../stores/tabSwitcherStore"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

const STEP_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
}

function switcherStep(trigger: TabSwitcherTrigger | null, key: string): 1 | -1 | undefined {
  if (!trigger) return STEP_KEYS[key]
  return trigger.reverse ? -1 : 1
}

function claim(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

export function useTabSwitcherHotkeys(
  keybindings: KeybindingsSnapshot | null,
  enabled: boolean,
  onFocusTab: (tabId: string) => void,
  dom: DomPort = domAdapter,
): void {
  useEffect(() => {
    if (!enabled) return

    const switcher = useTabSwitcherStore.getState

    function commit(): void {
      const tabId = switcher().commitSwitcher()
      if (tabId) onFocusTab(tabId)
    }

    function handleOpenSwitcherKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        claim(event)
        switcher().closeSwitcher()
        return
      }
      if (event.key === "Enter") {
        claim(event)
        commit()
        return
      }
      const step = switcherStep(matchTabSwitcherTrigger(keybindings, event), event.key)
      if (!step) return
      claim(event)
      switcher().stepSwitcher(step)
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (switcher().order) {
        handleOpenSwitcherKey(event)
        return
      }

      switcher().setJumpHintsVisible(shouldShowTabJumpHints(keybindings, event))

      const trigger = matchTabSwitcherTrigger(keybindings, event)
      if (trigger) {
        claim(event)
        const { layout, recentTabIds } = usePaneLayoutStore.getState()
        const order = orderTabsByRecency(layout, recentTabIds).map((entry) => entry.tab.tabId)
        switcher().openSwitcher(order, trigger.binding, trigger.reverse)
        return
      }

      const digit = tabJumpDigit(keybindings, event)
      if (digit === null) return
      const tabId = tabJumpTarget(focusedPaneOf(usePaneLayoutStore.getState().layout), digit)
      if (!tabId) return
      claim(event)
      onFocusTab(tabId)
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const { order, holdBinding, setJumpHintsVisible } = switcher()
      setJumpHintsVisible(shouldShowTabJumpHints(keybindings, event))
      if (order && holdBinding && bindingModifiersReleased(holdBinding, event)) commit()
    }

    function handleBlur(): void {
      switcher().closeSwitcher()
      switcher().setJumpHintsVisible(false)
    }

    const disposers = [
      dom.addWindowCaptureListener("keydown", handleKeyDown),
      dom.addWindowCaptureListener("keyup", handleKeyUp),
      dom.addWindowListener("blur", handleBlur),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      handleBlur()
    }
  }, [dom, enabled, keybindings, onFocusTab])
}
