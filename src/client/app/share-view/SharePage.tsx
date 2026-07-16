import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type { ShareError } from "../../../shared/session-share/types"
import { shareQueryOptions } from "../../api/share"
import { ShareViewPage } from "./ShareViewPage"
import { SharePageStore } from "./SharePage.store"

function errorTitle(error: ShareError): string {
  switch (error.kind) {
    case "not_found": return "Share not found"
    case "revoked": return "Share revoked"
    case "expired": return "Share expired"
    case "snapshot_read_failed": return "Share temporarily unavailable"
    default: return "Share error"
  }
}

function errorMessage(error: ShareError): string {
  switch (error.kind) {
    case "not_found": return "This share link does not exist."
    case "revoked": return "The owner has revoked this share."
    case "expired": return `This share expired on ${new Date(error.expiredAt).toISOString()}.`
    case "snapshot_read_failed": return "Try again later."
    default: return "Unexpected error."
  }
}

function SharePageInner({ token }: { token: string }) {
  const loadState = SharePageStore.useScopedStore((s) => s.loadState)
  const setLoadState = SharePageStore.useScopedStore((s) => s.setLoadState)
  const query = useQuery(shareQueryOptions(token))

  useEffect(() => {
    if (query.isPending) return
    if (query.isError) {
      const err = query.error
      setLoadState({
        kind: "error",
        error: { kind: "snapshot_read_failed", message: err instanceof Error ? err.message : String(err) },
        status: 0,
      })
      return
    }
    const body = query.data
    if (body.ok) {
      setLoadState({ kind: "ok", snapshot: body.snapshot })
    } else {
      setLoadState({ kind: "error", error: body.error, status: 0 })
    }
  }, [query.isPending, query.isError, query.error, query.data, setLoadState])

  if (loadState.kind === "loading") {
    return (
      <main className="kanna-share-view" data-state="loading">
        <p>Loading shared chat…</p>
      </main>
    )
  }
  if (loadState.kind === "error") {
    return (
      <main className="kanna-share-view" data-state="error">
        <h1>{errorTitle(loadState.error)}</h1>
        <p>{errorMessage(loadState.error)}</p>
      </main>
    )
  }
  return <ShareViewPage snapshot={loadState.snapshot} />
}

export function SharePage() {
  const params = useParams<{ token: string }>()
  const token = params.token ?? ""
  return (
    <SharePageStore.Provider init={{}}>
      <SharePageInner token={token} />
    </SharePageStore.Provider>
  )
}
