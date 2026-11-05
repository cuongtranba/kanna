import { isJsonObject, type JsonValue } from "../../shared/json"
import { HTTP_ROUTES } from "../../shared/http-routes"
import type { AuthManager } from "../auth"
import type { InboxActions } from "../ws-router-inbox"

const ROUTE = HTTP_ROUTES.inboxProposalApprove

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

function isSameOrigin(req: Request, auth: Pick<AuthManager, "validateOrigin"> | null): boolean {
  const origin = req.headers.get("origin")
  if (origin === null) return false
  return auth === null ? origin === new URL(req.url).origin : auth.validateOrigin(req)
}

async function readIds(req: Request): Promise<{ threadId: string; proposalId: string } | null> {
  let body: JsonValue
  try {
    body = await req.json()
  } catch {
    return null
  }
  if (!isJsonObject(body)) return null
  const { threadId, proposalId } = body
  if (typeof threadId !== "string" || threadId.length === 0) return null
  if (typeof proposalId !== "string" || proposalId.length === 0) return null
  return { threadId, proposalId }
}

export async function handleProposalApproveRequest(
  req: Request,
  url: URL,
  approveProposal: InboxActions["approveProposal"],
  auth: Pick<AuthManager, "validateOrigin"> | null,
): Promise<Response | null> {
  if (url.pathname !== ROUTE.path) return null
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } })
  if (!isSameOrigin(req, auth)) return jsonError(403, "Forbidden")
  const ids = await readIds(req)
  if (ids === null) return jsonError(400, "threadId and proposalId are required")
  const sent = await approveProposal(ids.threadId, ids.proposalId)
  if (!sent.ok) return jsonError(409, sent.error)
  return Response.json({ outboundId: sent.outboundId })
}
