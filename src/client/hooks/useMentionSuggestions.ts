import { useEffect, useRef } from "react"
import { ChatTabScopedStore, type MentionSuggestionsState } from "../stores/chatTabScopedStore"
import { fetchProjectPaths, type ProjectPath } from "../api/projects"
import type { CommandPort } from "../ports/commandPort"
import type { TimerPort } from "../ports/timerPort"
import { useOptionalKannaSocket } from "../app/KannaSocketProvider"
import { timerAdapter } from "../adapters/timer.adapter"
import { onRejected } from "../../shared/errors"

export type { ProjectPath }

const DEBOUNCE_MS = 120

interface MentionSuggestionsPorts {
  commands?: CommandPort
  timer?: TimerPort
}

const EMPTY_STATE: MentionSuggestionsState = { items: [], loading: false, error: null }

export function useMentionSuggestions(args: {
  projectId: string | null
  query: string
  enabled: boolean
  ports?: MentionSuggestionsPorts
}): MentionSuggestionsState {
  const socket = useOptionalKannaSocket()
  const commands = args.ports?.commands ?? socket
  const timer = args.ports?.timer ?? timerAdapter
  const state = ChatTabScopedStore.useScopedStore((s) => s.mentionSuggestions)
  const setMentionSuggestions = ChatTabScopedStore.useScopedStore((s) => s.setMentionSuggestions)
  const chatTabStoreApi = ChatTabScopedStore.useScopedStoreApi()
  const debounceRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!args.enabled || !args.projectId) {
      setMentionSuggestions(EMPTY_STATE)
      return
    }

    if (debounceRef.current !== null) timer.clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    setMentionSuggestions({ items: chatTabStoreApi.getState().mentionSuggestions.items, loading: true, error: null })
    const controller = new AbortController()
    abortRef.current = controller

    debounceRef.current = timer.setTimeout(() => {
      fetchProjectPaths(commands, args.projectId!, args.query).then(
        (items) => {
          if (controller.signal.aborted) return
          setMentionSuggestions({ items, loading: false, error: null })
        },
        onRejected((error) => {
          if (controller.signal.aborted) return
          setMentionSuggestions({ items: [], loading: false, error: error.message })
        }),
      )
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current !== null) timer.clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [args.enabled, args.projectId, args.query, commands, timer, setMentionSuggestions, chatTabStoreApi])

  return state
}
