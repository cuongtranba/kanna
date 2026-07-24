// src/server/orchestration-diff.ts
//
// Pure diff-bounding for orchestration review prompts. `diffAgainstBase`
// output is otherwise injected verbatim into every review worker's prompt —
// one large implement phase (lockfiles, generated code) would blow the
// review context or burn tokens on content no reviewer can act on.

/** Char budget for the {{DIFF}} template var (matches MAX_PHASE_OUTPUT_CHARS). */
export const MAX_DIFF_CHARS = 64_000

interface DiffSegment {
  file: string
  text: string
  additions: number
  deletions: number
}

function parseSegments(diff: string): DiffSegment[] {
  const parts = diff.split(/^(?=diff --git )/mu).filter((p) => p.length > 0)
  return parts.map((text) => {
    const header = text.slice(0, text.indexOf("\n"))
    const match = /^diff --git a\/.+? b\/(.+)$/u.exec(header)
    let additions = 0
    let deletions = 0
    for (const line of text.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions += 1
      else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1
    }
    return { file: match?.[1] ?? header, text, additions, deletions }
  })
}

/**
 * Bound a `git diff` to `budget` chars. Under budget → returned verbatim.
 * Over budget → a header lists every changed file (+/- counts, omitted
 * markers), then whole file segments are packed greedily IN ORDER, skipping
 * any segment that no longer fits so a giant early file (e.g. a lockfile)
 * cannot starve later source files. If nothing fits whole, the first
 * segment is included truncated. The trailing note points reviewers at
 * `git diff` in the worktree (their cwd) for the full content.
 */
export function boundDiff(diff: string, budget: number = MAX_DIFF_CHARS): string {
  if (diff.length <= budget) return diff
  const segments = parseSegments(diff)
  if (segments.length === 0) return diff.slice(0, budget)

  const included = new Set<number>()
  let used = 0
  // Reserve room for the header: one row per file plus the banner/footer.
  const reserve = 300 + segments.reduce((n, s) => n + s.file.length + 32, 0)
  const packBudget = Math.max(budget - reserve, 0)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    if (used + seg.text.length <= packBudget) {
      included.add(i)
      used += seg.text.length
    }
  }
  let truncatedFirst = ""
  if (included.size === 0) {
    // Single oversized segment (or all oversized): show a truncated slice of the first.
    truncatedFirst = `${segments[0]!.text.slice(0, packBudget)}\n[... segment truncated ...]\n`
  }

  const fileRows = segments
    .map((seg, i) => {
      const marker = included.has(i) ? "" : " [omitted]"
      return ` ${seg.file} (+${seg.additions}/-${seg.deletions})${marker}`
    })
    .join("\n")
  const banner =
    `=== DIFF TRUNCATED: ${included.size} of ${segments.length} changed files shown ` +
    `(${diff.length} chars total, budget ${budget}). ` +
    `Run \`git diff <base>\` in this worktree for the full diff. ===\n` +
    `Changed files:\n${fileRows}\n\n`
  const body = truncatedFirst || segments.filter((_, i) => included.has(i)).map((s) => s.text).join("")
  return banner + body
}
