export function middleTruncate(name: string, max = 28): string {
  if (name.length <= max) return name
  const ellipsis = "…"
  const dotIndex = name.lastIndexOf(".")
  const hasShortExt = dotIndex > 0 && name.length - dotIndex <= 6
  const ext = hasShortExt ? name.slice(dotIndex) : ""
  const stem = hasShortExt ? name.slice(0, dotIndex) : name

  const budget = max - ellipsis.length - ext.length
  if (budget <= 2) {
    const fallback = max - ellipsis.length
    const head = Math.ceil(fallback / 2)
    const tail = Math.floor(fallback / 2)
    return `${name.slice(0, head)}${ellipsis}${name.slice(name.length - tail)}`
  }

  const head = Math.ceil(budget / 2)
  const tail = budget - head
  return `${stem.slice(0, head)}${ellipsis}${stem.slice(stem.length - tail)}${ext}`
}
