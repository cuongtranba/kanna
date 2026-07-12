import { useEffect } from "react"
import { useParams } from "react-router-dom"
import type { ChatSnapshot, ShareError } from "../../../shared/session-share/types"
import { ShareViewPage } from "./ShareViewPage"
import { SharePageStore } from "./SharePage.store"

interface ShareApiOk {
  ok: true
  snapshot: ChatSnapshot
}
interface ShareApiErr {
  ok: false
  error: ShareError
}
type ShareApiResponse = ShareApiOk | ShareApiErr

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

  useEffect(() => {
    let aborted = false
    const ac = new AbortController()
    fetch(`/api/share/${encodeURIComponent(token)}`, { signal: ac.signal })
      .then(async (res) => {
        const body: ShareApiResponse = await res.json()
        if (aborted) return
        if (body.ok) {
          setLoadState({ kind: "ok", snapshot: body.snapshot })
        } else {
          setLoadState({ kind: "error", error: body.error, status: res.status })
        }
      })
      .catch((err) => {
        if (aborted) return
        if (err instanceof Error && err.name === "AbortError") return
        setLoadState({
          kind: "error",
          error: { kind: "snapshot_read_failed", message: String(err) },
          status: 0,
        })
      })
    return () => {
      aborted = true
      ac.abort()
    }
  }, [token, setLoadState])

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
