import { useEffect, useRef, useState } from "react"

export interface ProjectPath {
  path: string
  kind: "file" | "dir"
}

interface State {
  items: ProjectPath[]
  loading: boolean
  error: string | null
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
    const payload = await response.json() as { paths?: ProjectPath[] }
    return payload.paths ?? []
  } catch {
    return []
  }
}

export function useMentionSuggestions(args: {
  projectId: string | null
  query: string
  enabled: boolean
}): State {
  const [state, setState] = useState<State>({ items: [], loading: false, error: null })
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!args.enabled || !args.projectId) {
      setState({ items: [], loading: false, error: null })
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()

    setState((s) => ({ ...s, loading: true, error: null }))
    const controller = new AbortController()
    abortRef.current = controller

    debounceRef.current = setTimeout(async () => {
      const items = await fetchProjectPaths({
        projectId: args.projectId!,
        query: args.query,
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      setState({ items, loading: false, error: null })
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      controller.abort()
    }
  }, [args.enabled, args.projectId, args.query])

  return state
}
