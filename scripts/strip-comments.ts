import { listScopedFiles, stripComments } from "./comment-scan"

const dryRun = process.argv.includes("--dry-run")
const explicit = process.argv.slice(2).filter((arg) => !arg.startsWith("--"))

const repoRoot = process.cwd()
const files = explicit.length > 0 ? explicit : await listScopedFiles(repoRoot)

let changed = 0
let linesRemoved = 0

for (const file of files) {
  const before = await Bun.file(file).text()
  const after = stripComments(file, before)
  if (after === before) continue
  changed += 1
  linesRemoved += before.split("\n").length - after.split("\n").length
  if (!dryRun) await Bun.write(file, after)
}

const verb = dryRun ? "would change" : "changed"
console.log(`strip-comments: ${verb} ${changed}/${files.length} files, ${linesRemoved} lines removed`)
