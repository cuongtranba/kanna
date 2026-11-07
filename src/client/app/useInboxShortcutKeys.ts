import { useMemo } from "react"
import type { KeybindingAction } from "../../shared/app-settings-types"
import { domAdapter } from "../adapters/dom.adapter"
import { formatBindingKeys, getBindingsForAction, pickPlatformBinding } from "../lib/keybindings"
import { isMacUserAgent } from "../lib/quickSwitcher"
import type { DomPort } from "../ports/domPort"
import { selectKeybindings, useKannaStateStore } from "../stores/kannaStateStore"

export function useInboxShortcutKeys(action: KeybindingAction, dom: DomPort = domAdapter): readonly string[] {
  const keybindings = useKannaStateStore(selectKeybindings)
  return useMemo(() => {
    const isMac = isMacUserAgent(dom.getUserAgent())
    const binding = pickPlatformBinding(getBindingsForAction(keybindings, action), isMac)
    return binding === null ? [] : formatBindingKeys(binding, isMac)
  }, [action, dom, keybindings])
}
