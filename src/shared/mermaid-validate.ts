/**
 * Join the parser port to the pieces that make its answer readable.
 *
 * Both callers — the `validate_mermaid` MCP tool and the end-of-turn guard —
 * go through here, so the model reads the same structured defect whichever
 * path found it.
 *
 * Pure — the only side effect is the injected {@link MermaidParsePort}.
 */

import { extractMermaidFences, type MermaidFence } from "./mermaid-fences"
import { hintForMermaidError } from "./mermaid-hints"
import type { MermaidParsePort, MermaidValidation } from "./mermaid-validation"
import { parseMermaidError } from "./mermaidError"

export interface MermaidFenceValidation {
  fence: MermaidFence
  result: MermaidValidation
}

export async function validateMermaid(
  parse: MermaidParsePort,
  source: string,
): Promise<MermaidValidation> {
  const parsed = await parse(source)
  if (parsed.ok) return { ok: true }

  const detail = parseMermaidError(parsed.raw)
  return { ok: false, defect: { ...detail, hint: hintForMermaidError(source, detail) } }
}

export async function validateMermaidFences(
  parse: MermaidParsePort,
  markdown: string,
): Promise<readonly MermaidFenceValidation[]> {
  return await Promise.all(
    extractMermaidFences(markdown).map(async (fence) => ({
      fence,
      result: await validateMermaid(parse, fence.source),
    })),
  )
}
