import { useEffect, useRef } from "react"
import { useComposerStore, type MentionSuggestionsState } from "../stores/composerStore"

export interface ProjectPath {
  path: string
  kind: "file" | "dir"
}

const DEBOUNCE_MS = 120

export async function fetchProjectPaths(args: {
  projectId: string
  query: string
  signal: AbortSignal
}): Promise<ProjectPath[]> {
  const params = new URLSearchParams({ query: args.query })
  try {
    const response = await fetch(`/api/projects/${args.projectId}/paths?${params.toString()}`, {
      signal: args.signal,
    })
    if (!response.ok) return []
    const payload: { paths?: ProjectPath[] } = await response.json()
    return payload.paths ?? []
  } catch {
    return []
  }
}

const EMPTY_STATE: MentionSuggestionsState = { items: [], loading: false, error: null }

export function useMentionSuggestions(args: {
  projectId: string | null
  query: string
  enabled: boolean
}): MentionSuggestionsState {
  const state = useComposerStore((s) => s.mentionSuggestions)
  const setMentionSuggestions = useComposerStore((s) => s.setMentionSuggestions)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!args.enabled || !args.projectId) {
      setMentionSuggestions(EMPTY_STATE)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    setMentionSuggestions({ items: useComposerStore.getState().mentionSuggestions.items, loading: true, error: null })
    const controller = new AbortController()
    abortRef.current = controller

    debounceRef.current = setTimeout(async () => {
      const items = await fetchProjectPaths({
        projectId: args.projectId!,
        query: args.query,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setMentionSuggestions({ items, loading: false, error: null })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [args.enabled, args.projectId, args.query, setMentionSuggestions])

  return state
}
