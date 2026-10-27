export function normalizeAnthropicBaseUrl(raw: string, maxLength: number): string | null {
  const trimmed = raw.trim().slice(0, maxLength)
  if (!trimmed) return null
  if (!/^https?:\/\/\S+$/.test(trimmed)) return null
  return trimmed.replace(/\/+$/, "")
}

export type BaseUrlDraft =
  | { kind: "default" }
  | { kind: "url"; url: string }
  | { kind: "invalid" }

export const BASE_URL_SCHEME_MESSAGE = "Must start with http:// or https://"

export function parseBaseUrlDraft(raw: string, maxLength: number): BaseUrlDraft {
  if (raw.trim().length === 0) return { kind: "default" }
  const url = normalizeAnthropicBaseUrl(raw, maxLength)
  return url === null ? { kind: "invalid" } : { kind: "url", url }
}
