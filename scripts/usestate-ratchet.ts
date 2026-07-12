import { countByFile, evaluateRatchet, type RatchetMode } from "./usestate-ratchet-lib"

interface AstGrepScanMatch {
  file: string
  ruleId: string
}

const BASELINE_PATH = new URL("../usestate-baseline.json", import.meta.url).pathname

function scanMatches(): AstGrepScanMatch[] {
  const proc = Bun.spawnSync(
    ["node_modules/.bin/ast-grep", "scan", "--json", "src/client"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const raw = proc.stdout.toString().trim()
  if (!raw) return []
  const parsed = JSON.parse(raw) as AstGrepScanMatch[]
  return parsed.filter((match) => match.ruleId.startsWith("no-react-usestate"))
}

async function readBaseline(): Promise<number> {
  const file = Bun.file(BASELINE_PATH)
  if (!(await file.exists())) {
    console.error(`Missing ${BASELINE_PATH} — run with --update to create it.`)
    process.exit(2)
  }
  const parsed = (await file.json()) as { count: number }
  return parsed.count
}

const matches = scanMatches()
const byFile = countByFile(matches.map((match) => match.file))
const total = matches.length

if (process.argv.includes("--update")) {
  await Bun.write(BASELINE_PATH, `${JSON.stringify({ count: total }, null, 2)}\n`)
  console.log(`Baseline updated: ${total} violations.`)
  process.exit(0)
}

if (process.argv.includes("--markdown")) {
  const { renderMarkdownReport } = await import("./usestate-ratchet-lib")
  console.log(renderMarkdownReport(byFile, new Date().toISOString().slice(0, 10)))
  process.exit(0)
}

const mode: RatchetMode = process.argv.includes("--zero") ? "zero" : "ratchet"
const baseline = mode === "zero" ? 0 : await readBaseline()
const result = evaluateRatchet(total, baseline, mode)

const sorted = Object.entries(byFile).sort(([, a], [, b]) => b - a)
for (const [file, count] of sorted) console.log(`${String(count).padStart(4)}  ${file}`)
console.log(result.message)
process.exit(result.ok ? 0 : 1)
