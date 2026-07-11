import type { AnyValue } from "../errors"
import { isRecord } from "../errors"

export const CHAT_SNAPSHOT_VERSION = 1 as const

export interface ChatMeta {
  id: string
  title: string
  model: string
  createdAt: number
}

export type ChatSnapshotMessage =
  | { kind: "user_prompt"; id: string; createdAt: number; text: string }
  | { kind: "assistant_text"; id: string; createdAt: number; text: string }
  | { kind: "assistant_thinking"; id: string; createdAt: number; text: string }
  | { kind: "tool_call"; id: string; createdAt: number; name: string; input: AnyValue }
  | { kind: "tool_result"; id: string; createdAt: number; toolCallId: string; output: AnyValue; isError: boolean }
  | { kind: "diff"; id: string; createdAt: number; path: string; patch: string }
  | { kind: "terminal_chunk"; id: string; createdAt: number; chunk: string }
  | { kind: "omitted"; id: string; createdAt: number; reason: "too_large" }

export interface AttachmentManifestEntry {
  filename: string
  sizeBytes: number
  inlineBase64?: string
}

export interface ChatSnapshot {
  version: typeof CHAT_SNAPSHOT_VERSION
  chatMeta: ChatMeta
  messages: ChatSnapshotMessage[]
  attachmentsManifest: AttachmentManifestEntry[]
}

export type ShareError =
  | { kind: "chat_not_found"; chatId: string }
  | { kind: "snapshot_too_large"; sizeBytes: number }
  | { kind: "snapshot_write_failed"; message: string }
  | { kind: "not_found" }
  | { kind: "revoked" }
  | { kind: "expired"; expiredAt: number }
  | { kind: "snapshot_read_failed"; message: string }

const SHARE_ERROR_KINDS = new Set<string>([
  "chat_not_found",
  "snapshot_too_large",
  "snapshot_write_failed",
  "not_found",
  "revoked",
  "expired",
  "snapshot_read_failed",
])

export function isShareError(value: AnyValue): value is ShareError {
  if (!isRecord(value)) return false
  const kind = value.kind
  return typeof kind === "string" && SHARE_ERROR_KINDS.has(kind)
}

export interface ShareSummary {
  tokenId: string
  chatId: string
  url: string
  expiresAt: number
  createdAt: number
  revoked: boolean
}

export interface MintRequest {
  chatId: string
  ttlHours?: number
}

export interface MintResponse {
  summary: ShareSummary
}

export interface RevokeRequest {
  tokenId: string
}
