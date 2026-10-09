export const TRANSFER_PROTOCOL = 3
export const TRANSFER_CHUNK_BYTES = 8 * 1024 * 1024
export const TRANSFER_MAX_CHUNK_BYTES = 16 * 1024 * 1024
export const TRANSFER_IDLE_TIMEOUT_MS = 120_000
export const TRANSFER_CHUNK_ATTEMPTS = 5
export const TRANSFER_RETRY_BASE_MS = 1000
export const TRANSFER_KEEPALIVE_MS = 30_000
export const TRANSFER_REQUEST_TIMEOUT_MS = 600_000
export const TRANSFER_PART_SUFFIX = ".kanna-part"
export const TRANSFER_ROUTE = "/beacon/transfer"
export const TRANSFER_COMPLETE_ROUTE = "/beacon/transfer/complete"

export const SHA256_HEX = /^[0-9a-f]{64}$/

export type TransferDirection = "upload" | "download"

export type BeaconTransferResult = {
  path: string
  bytes: number
  sha256: string
}

export function transferRetryDelayMs(attempt: number): number {
  return TRANSFER_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1)
}

export function isFatalTransferStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 409
}
