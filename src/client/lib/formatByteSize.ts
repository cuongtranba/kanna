const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export function formatByteSize(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${BYTE_UNITS[unit]}`
}
