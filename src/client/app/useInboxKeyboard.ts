import { useEffect, useMemo } from "react"
import { isSnoozable } from "../../shared/inbox/policy"
import type { InboxThread } from "../../shared/inbox/types"
import { domAdapter } from "../adapters/dom.adapter"
import { approveInboxProposal, archiveInboxThreads, toggleInboxThreadUnread } from "../lib/inboxActions"
import type { InboxRecord } from "../lib/inboxFilter"
import { adjacentThreadId, INBOX_KEY_COMMANDS, isInboxTypingTarget } from "../lib/inboxKeyboard"
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
      const typing = isInboxTypingTarget(event.target)
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
          archiveInboxThreads(socket, [selected.id], onCloseDetail)
          return
        case "toggleUnread":
          if (selected === null) return
          event.preventDefault()
          toggleInboxThreadUnread(socket, selected)
          return
        case "toggleSelect":
          if (selected === null) return
          event.preventDefault()
          useInboxStore.getState().toggleChecked(selected.id)
          return
        case "snoozeThread":
          if (selected === null || !isSnoozable(selected)) return
          event.preventDefault()
          useInboxStore.getState().setSnoozeMenu("detail")
          return
        case "approveProposal":
          if (selected?.proposal?.status !== "open") return
          event.preventDefault()
          approveInboxProposal(socket, selected.id, selected.proposal.id)
          return
        case "closeThread":
          if (event.defaultPrevented || useInboxStore.getState().shortcutsOpen) return
          if (useInboxStore.getState().clearChecked()) {
            event.preventDefault()
            return
          }
          if (selected === null) return
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
