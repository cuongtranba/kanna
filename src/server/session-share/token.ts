import { randomBytes } from "node:crypto"

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

export function isShareTokenId(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value)
}

export function generateShareToken(): string {
  return randomBytes(32).toString("base64url")
}
