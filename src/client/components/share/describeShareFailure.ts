import type { ShareError } from "../../../shared/session-share/types"

export function describeShareFailure(error: ShareError): string {
  switch (error.kind) {
    case "chat_not_found":
      return "This chat no longer exists."
    case "snapshot_too_large":
      return `This chat is too large to share (${String(error.sizeBytes)} bytes).`
    case "snapshot_write_failed":
    case "snapshot_read_failed":
      return error.message
    case "not_found":
      return "That share link no longer exists."
    case "revoked":
      return "That share link was already revoked."
    case "expired":
      return "That share link has expired."
  }
}
