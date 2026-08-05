import { useEffect, useRef } from "react"
import { ChatTabScopedStore, type MentionSuggestionsState } from "../stores/chatTabScopedStore"
import { fetchProjectPaths, type ProjectPath } from "../api/projects"
import type { HttpPort } from "../ports/httpPort"
import type { TimerPort } from "../ports/timerPort"
import { httpAdapter } from "../adapters/http.adapter"
import { timerAdapter } from "../adapters/timer.adapter"

export type { ProjectPath }

const DEBOUNCE_MS = 120

interface MentionSuggestionsPorts {
  http: HttpPort
  timer: TimerPort
}

const DEFAULT_PORTS: MentionSuggestionsPorts = {
  http: httpAdapter,
  timer: timerAdapter,
}

const EMPTY_STATE: MentionSuggestionsState = { items: [], loading: false, error: null }

export function useMentionSuggestions(args: {
  projectId: string | null
  query: string
  enabled: boolean
  ports?: MentionSuggestionsPorts
}): MentionSuggestionsState {
  const { http, timer } = args.ports ?? DEFAULT_PORTS
  const state = ChatTabScopedStore.useScopedStore((s) => s.mentionSuggestions)
  const setMentionSuggestions = ChatTabScopedStore.useScopedStore((s) => s.setMentionSuggestions)
  // Store API gives us a stable reference to read current state inside effects
  // without adding `state` to the dependency array (which would re-trigger on
  // every suggestion update).
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
      void fetchProjectPaths(args.projectId!, args.query, { signal: controller.signal, http }).then((items) => {
        if (controller.signal.aborted) return
        setMentionSuggestions({ items, loading: false, error: null })
      })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current !== null) timer.clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [args.enabled, args.projectId, args.query, http, timer, setMentionSuggestions, chatTabStoreApi])

  return state
}
