import type { ChatSnapshot, ShareError } from "../../shared/session-share/types"
import type { Result } from "./index"

interface ShareReadSurface {
  getShare(tokenId: string): Promise<Result<{ snapshot: ChatSnapshot }>>
}

const TOKEN_RE = /^\/api\/share\/([A-Za-z0-9_-]{20,128})$/

function jsonError(status: number, error: ShareError): Response {
  return Response.json({ ok: false, error }, { status })
}

function describeStatus(error: ShareError): number {
  switch (error.kind) {
    case "not_found": return 404
    case "revoked": return 410
    case "expired": return 410
    case "snapshot_read_failed": return 500
    default: return 500
  }
}

export async function handleShareApiRequest(req: Request, service: ShareReadSurface): Promise<Response> {
  const { pathname } = new URL(req.url)
  const match = TOKEN_RE.exec(pathname)
  if (!match) return jsonError(404, { kind: "not_found" })
  const result = await service.getShare(match[1]!)
  if (!result.ok) return jsonError(describeStatus(result.error), result.error)
  return Response.json({ ok: true, snapshot: result.data.snapshot })
}
