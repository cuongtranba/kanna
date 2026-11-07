import { useCallback, useMemo } from "react"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Kbd, KbdGroup } from "../components/ui/kbd"
import { domAdapter } from "../adapters/dom.adapter"
import { INBOX_SHORTCUT_ACTIONS, inboxShortcutLabel } from "../lib/inboxKeyboard"
import { formatBindingKeys, getResolvedKeybindings } from "../lib/keybindings"
import { isMacUserAgent } from "../lib/quickSwitcher"
import { selectShortcutsOpen, useInboxStore } from "../stores/inboxStore"
import { selectKeybindings, useKannaStateStore } from "../stores/kannaStateStore"

export function InboxShortcutsDialog() {
  const open = useInboxStore(selectShortcutsOpen)
  const keybindings = useKannaStateStore(selectKeybindings)
  const rows = useMemo(() => {
    const isMac = isMacUserAgent(domAdapter.getUserAgent())
    const resolved = getResolvedKeybindings(keybindings)
    return INBOX_SHORTCUT_ACTIONS.map((action) => ({
      action,
      label: inboxShortcutLabel(action),
      combos: (resolved.bindings[action] ?? []).map((binding) => formatBindingKeys(binding, isMac)),
    }))
  }, [keybindings])
  const handleOpenChange = useCallback((next: boolean) => useInboxStore.getState().setShortcutsOpen(next), [])
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Inbox shortcuts</DialogTitle>
          <DialogDescription>They work on the Inbox page while you are not typing in a box.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.action} className="flex items-center justify-between gap-4 py-2 text-sm text-foreground">
                <span>{row.label}</span>
                <span className="flex items-center gap-2">
                  {row.combos.map((keys) => (
                    <KbdGroup key={keys.join("+")}>
                      {keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
