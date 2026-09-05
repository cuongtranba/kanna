
import type { MermaidErrorDetail } from "./mermaidError"

export interface MermaidDefect extends MermaidErrorDetail {
  hint: string | null
}

export type MermaidValidation = { ok: true } | { ok: false; defect: MermaidDefect }

export type MermaidParseResult = { ok: true } | { ok: false; raw: string }

export type MermaidParsePort = (source: string) => Promise<MermaidParseResult>
