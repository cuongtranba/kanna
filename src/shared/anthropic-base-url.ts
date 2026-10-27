export function normalizeAnthropicBaseUrl(raw: string, maxLength: number): string | null {
  const trimmed = raw.trim().slice(0, maxLength)
  if (!trimmed) return null
  if (!/^https?:\/\/\S+$/.test(trimmed)) return null
  return trimmed.replace(/\/+$/, "")
}
