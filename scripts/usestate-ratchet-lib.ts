export type RatchetMode = "ratchet" | "zero"

export interface RatchetEvaluation {
  ok: boolean
  total: number
  baseline: number
  message: string
}

export function countByFile(matchFiles: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const file of matchFiles) {
    counts[file] = (counts[file] ?? 0) + 1
  }
  return counts
}

export function evaluateRatchet(total: number, baseline: number, mode: RatchetMode): RatchetEvaluation {
  if (mode === "zero") {
    return {
      ok: total === 0,
      total,
      baseline,
      message: total === 0
        ? "useState violations: 0 — goal met."
        : `useState violations: ${total} — goal is 0.`,
    }
  }
  return {
    ok: total <= baseline,
    total,
    baseline,
    message: total <= baseline
      ? `useState violations: ${total} (baseline ${baseline}) — OK.`
      : `useState violations: ${total} exceed baseline ${baseline} — new useState introduced. Remove it or migrate it to Zustand.`,
  }
}

export function renderMarkdownReport(byFile: Record<string, number>, generatedAt: string): string {
  const rows = Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b))
  const total = rows.reduce((sum, [, count]) => sum + count, 0)
  const lines = [
    `# useState violation report (${generatedAt})`,
    "",
    `Total: ${total} violations across ${rows.length} files.`,
    "",
    "| File | Violations |",
    "| --- | --- |",
    ...rows.map(([file, count]) => `| ${file} | ${count} |`),
    "",
  ]
  return lines.join("\n")
}
