import { findSqueezedFlexText, listClientFiles, type FlexOverflowReason } from "./flex-overflow-scan"

const FIX_BY_REASON: Record<FlexOverflowReason, string> = {
  "undeclared-text":
    "data text in a non-wrapping flex row beside a shrink-0 sibling must declare its overflow: truncate, line-clamp-N, break-all, or min-w-0 break-words to yield; shrink-0 or whitespace-nowrap to hold",
  "nothing-yields":
    "every data text child of this row holds its width, so the row overlaps its neighbours when narrow; let the longest value truncate, or add flex-wrap",
}

const repoRoot = process.cwd()
const files = await listClientFiles(repoRoot)
const report: string[] = []
const reasons = new Set<FlexOverflowReason>()

for (const file of files) {
  for (const hit of findSqueezedFlexText(file, await Bun.file(file).text())) {
    reasons.add(hit.reason)
    report.push(`${file}:${hit.line}  [${hit.reason}]  ${hit.snippet}`)
  }
}

if (report.length === 0) {
  console.log(`flex-overflow: clean (${files.length} files)`)
  process.exit(0)
}

console.error(report.join("\n"))
console.error("")
for (const reason of reasons) console.error(`${reason}: ${FIX_BY_REASON[reason]}.`)
console.error(
  `\nflex-overflow: ${report.length} squeezed row(s). See "Flex rows never overlap" in .claude/skills/kanna-react-style/SKILL.md.`,
)
process.exit(1)
