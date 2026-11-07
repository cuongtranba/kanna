import { useEffect, useMemo } from "react"
import type { InboxThread } from "../../shared/inbox/types"
import { domAdapter } from "../adapters/dom.adapter"
import { isTypingTarget } from "../components/panes/paneKeyboard"
import { approveInboxProposal, archiveInboxThread } from "../lib/inboxActions"
import type { InboxRecord } from "../lib/inboxFilter"
import { adjacentThreadId, INBOX_KEY_COMMANDS } from "../lib/inboxKeyboard"
import { getResolvedKeybindings, resolveBoundCommand } from "../lib/keybindings"
import type { DomPort } from "../ports/domPort"
import { useInboxStore } from "../stores/inboxStore"
import { selectKeybindings, useKannaStateStore } from "../stores/kannaStateStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

export function useInboxKeyboard(
  records: readonly InboxRecord[],
  selected: InboxThread | null,
  onOpenThread: (threadId: string) => void,
  onCloseDetail: () => void,
  dom: DomPort = domAdapter,
): void {
  const socket = useOptionalKannaSocket()
  const keybindings = useKannaStateStore(selectKeybindings)
  const resolved = useMemo(() => getResolvedKeybindings(keybindings), [keybindings])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const target = event.target
      const typing = isTypingTarget(target instanceof HTMLElement ? target : null)
      const command = resolveBoundCommand(INBOX_KEY_COMMANDS, resolved, event, typing)
      if (command === null) return
      const selectedId = selected?.id ?? null
      switch (command) {
        case "nextThread":
        case "prevThread": {
          const next = adjacentThreadId(records, selectedId, command === "nextThread" ? 1 : -1)
          if (next === null) return
          event.preventDefault()
          onOpenThread(next)
          return
        }
        case "focusComposer":
          if (selected === null) return
          event.preventDefault()
          useInboxStore.getState().focusComposer()
          return
        case "archiveThread":
          if (selected === null || selected.state === "archived") return
          event.preventDefault()
          archiveInboxThread(socket, selected.id, onCloseDetail)
          return
        case "approveProposal":
          if (selected?.proposal?.status !== "open") return
          event.preventDefault()
          approveInboxProposal(socket, selected.id, selected.proposal.id)
          return
        case "closeThread":
          if (selected === null || useInboxStore.getState().shortcutsOpen) return
          event.preventDefault()
          onCloseDetail()
          return
        case "focusSearch":
          if (!useInboxStore.getState().focusSearch()) return
          event.preventDefault()
          return
        case "showShortcuts":
          if (typing) return
          event.preventDefault()
          useInboxStore.getState().setShortcutsOpen(true)
      }
    }
    return dom.addWindowListener("keydown", handleKeydown)
  }, [dom, onCloseDetail, onOpenThread, records, resolved, selected, socket])
}
