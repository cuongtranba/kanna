import type { ChatSnapshot, ShareError } from "../../shared/session-share/types"
import type { ShareResult } from "./index"
import { isShareTokenId } from "./token"

interface ShareReadSurface {
  getShare(tokenId: string): Promise<ShareResult<{ snapshot: ChatSnapshot }>>
}

const SHARE_PATH_RE = /^\/api\/share\/([^/]+)$/

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
  const tokenId = SHARE_PATH_RE.exec(pathname)?.[1]
  if (tokenId === undefined || !isShareTokenId(tokenId)) return jsonError(404, { kind: "not_found" })
  const result = await service.getShare(tokenId)
  if (!result.ok) return jsonError(describeStatus(result.error), result.error)
  return Response.json({ ok: true, snapshot: result.data.snapshot })
}
