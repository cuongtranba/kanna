import { useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import type { ShareError } from "../../../shared/session-share/types"
import { shareQueryOptions } from "../../api/share"
import type { HttpPort } from "../../ports/httpPort"
import { ShareViewPage } from "./ShareViewPage"
import { errorMessage } from "../../../shared/errors"

function errorTitle(error: ShareError): string {
  switch (error.kind) {
    case "not_found": return "Share not found"
    case "revoked": return "Share revoked"
    case "expired": return "Share expired"
    case "snapshot_read_failed": return "Share temporarily unavailable"
    default: return "Share error"
  }
}

function shareErrorMessage(error: ShareError): string {
  switch (error.kind) {
    case "not_found": return "This share link does not exist."
    case "revoked": return "The owner has revoked this share."
    case "expired": return `This share expired on ${new Date(error.expiredAt).toISOString()}.`
    case "snapshot_read_failed": return "Try again later."
    default: return "Unexpected error."
  }
}

function ShareErrorView({ error }: { error: ShareError }) {
  return (
    <main className="kanna-share-view" data-state="error">
      <h1>{errorTitle(error)}</h1>
      <p>{shareErrorMessage(error)}</p>
    </main>
  )
}

function SharePageInner({ token, http }: { token: string; http?: HttpPort }) {
  const query = useQuery(shareQueryOptions(token, http))

  if (query.isPending) {
    return (
      <main className="kanna-share-view" data-state="loading">
        <p>Loading shared chat…</p>
      </main>
    )
  }
  if (query.isError) {
    return <ShareErrorView error={{ kind: "snapshot_read_failed", message: errorMessage(query.error) }} />
  }
  if (!query.data.ok) return <ShareErrorView error={query.data.error} />
  return <ShareViewPage snapshot={query.data.snapshot} />
}

export function SharePage({ http }: { http?: HttpPort }) {
  const params = useParams<{ token: string }>()
  return <SharePageInner token={params.token ?? ""} http={http} />
}
