
import { markdownDoc } from "./markdown"
import type { StructuredDoc } from "./types"

export function resolveStructuredDoc(ext: string): StructuredDoc | null {
  const normalized = ext.toLowerCase().replace(/^\./, "")
  if (normalized === "md" || normalized === "markdown") return markdownDoc
  return null
}
