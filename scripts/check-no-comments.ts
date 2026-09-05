import { findComments, listScopedFiles } from "./comment-scan"

const repoRoot = process.cwd()
const files = await listScopedFiles(repoRoot)

let offending = 0
let total = 0
const report: string[] = []

for (const file of files) {
  const text = await Bun.file(file).text()
  const hits = findComments(file, text)
  if (hits.length === 0) continue
  offending += 1
  total += hits.length
  for (const hit of hits.slice(0, 5)) {
    report.push(`${file}:${hit.line}  ${hit.raw.split("\n")[0]?.slice(0, 90)}`)
  }
  if (hits.length > 5) report.push(`${file}  … and ${hits.length - 5} more`)
}

if (offending === 0) {
  console.log(`no-comments: clean (${files.length} files)`)
  process.exit(0)
}

console.error(report.join("\n"))
console.error(
  `\nno-comments: ${total} comment(s) in ${offending} file(s). ` +
    `Run \`bun run strip:comments\`, or keep it only if a tool executes it ` +
    `(see "No Code Comments" in CLAUDE.md).`,
)
process.exit(1)
