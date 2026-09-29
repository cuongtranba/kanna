import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import {
  contentHash,
  DATASET_ERROR_MESSAGES,
  runDatasetQuery,
  type DatasetDecl,
  type DatasetQuery,
  type QueryResult,
} from "../../../shared/genui"
import { useGenUIHost } from "./host"
import { useGenUIView } from "./view-context"
import { GenUIViewStore } from "./view-store"

export type DatasetState =
  | { status: "loading" }
  | { status: "ok"; result: QueryResult; refreshing: boolean }
  | { status: "needs_approval"; server: string; tool: string; message: string }
  | { status: "error"; message: string }
  | { status: "unavailable"; message: string }

const FILE_POLL_SECONDS = 10

export const GENUI_DATASET_QUERY_KEY = "genui-dataset"

function pollIntervalMs(decl: DatasetDecl): number | false {
  if (decl.source === "file") return (decl.refreshSeconds ?? FILE_POLL_SECONDS) * 1000
  if (decl.source === "mcp" && decl.refreshSeconds) return decl.refreshSeconds * 1000
  return false
}

export function useDatasetDecl(datasetId: string | undefined): DatasetDecl | null {
  const { spec } = useGenUIView()
  return datasetId ? spec.datasets?.[datasetId] ?? null : null
}

export function useDatasetQuery(datasetId: string | undefined, query: DatasetQuery | null): DatasetState {
  const host = useGenUIHost()
  const decl = useDatasetDecl(datasetId)
  const nonce = GenUIViewStore.useScopedStore((state) => (datasetId ? state.refreshNonce[datasetId] ?? 0 : 0))
  const remote = decl !== null && decl.source !== "inline" && host.queryDataset !== null && query !== null

  const inline = useMemo(() => {
    if (!decl || decl.source !== "inline" || !query) return null
    return runDatasetQuery(decl, decl.rows, query)
  }, [decl, query])

  const queryDataset = host.queryDataset
  const remoteQuery = useQuery({
    queryKey: [GENUI_DATASET_QUERY_KEY, host.chatId, datasetId, decl ? contentHash(JSON.stringify(decl)) : null, query ? JSON.stringify(query) : null, nonce],
    queryFn: async () => {
      if (!decl || !query || !queryDataset) throw new Error("dataset is not queryable")
      return await queryDataset(decl, query, nonce > 0)
    },
    enabled: remote,
    placeholderData: keepPreviousData,
    refetchInterval: decl && remote && !host.readonly ? pollIntervalMs(decl) : false,
    retry: false,
  })

  if (!decl) return { status: "error", message: `This view refers to a dataset "${datasetId ?? ""}" it does not declare` }
  if (!query) return { status: "loading" }
  if (inline) {
    return inline.ok ? { status: "ok", result: inline.result, refreshing: false } : { status: "error", message: inline.message }
  }
  if (!host.queryDataset) return { status: "unavailable", message: "Live data is not included in a shared view" }
  if (remoteQuery.error) return { status: "error", message: DATASET_ERROR_MESSAGES.source_unavailable }
  const outcome = remoteQuery.data
  if (!outcome) return { status: "loading" }
  switch (outcome.status) {
    case "ok":
      return { status: "ok", result: outcome.result, refreshing: remoteQuery.isPlaceholderData }
    case "needs_approval":
      return outcome
    case "error":
      return { status: "error", message: `${DATASET_ERROR_MESSAGES[outcome.code]}: ${outcome.message}` }
  }
}
