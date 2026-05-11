export function maskToken(value: string): string {
  if (!value) return "—"
  const trimmed = value.trim()
  if (!trimmed) return "—"
  const last = trimmed.slice(-4)
  const prefix = trimmed.startsWith("sk-ant-") ? "sk-ant-" : ""
  return `${prefix}…${last}`
}
