
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import {
  formatCommitMessageFailure,
  validateCommitMessage,
} from "../src/ops/release/commit-message"

const RECORD_SEPARATOR = "\u001e"

interface Args {
  file: string | null
  range: string | null
  title: string | null
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { file: null, range: null, title: null }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1] ?? null
    if (flag === "--file") { args.file = value; index += 1 }
    else if (flag === "--range") { args.range = value; index += 1 }
    else if (flag === "--title") { args.title = value; index += 1 }
  }
  return args
}

interface Candidate {
  label: string
  message: string
}

function commitsInRange(range: string): Candidate[] {
  const result = spawnSync(
    "git",
    ["log", "--format=%H%n%B%x1e", range],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
  )
  if (result.status !== 0) {
    throw new Error(`git log ${range} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const newline = record.indexOf("\n")
      const sha = newline === -1 ? record : record.slice(0, newline)
      const message = newline === -1 ? "" : record.slice(newline + 1)
      return { label: sha.slice(0, 8), message }
    })
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const candidates: Candidate[] = []

  if (args.file !== null) {
    candidates.push({ label: args.file, message: readFileSync(args.file, "utf8") })
  }
  if (args.range !== null) {
    candidates.push(...commitsInRange(args.range))
  }
  if (args.title !== null) {
    candidates.push({ label: "PR title", message: `${args.title}\n` })
  }

  if (candidates.length === 0) {
    console.error("Nothing to check. Pass --file <path>, --range <range>, or --title <text>.")
    process.exit(2)
  }

  const failures: string[] = []
  for (const candidate of candidates) {
    const verdict = validateCommitMessage(candidate.message)
    if (!verdict.ok) failures.push(formatCommitMessageFailure(candidate.label, verdict))
  }

  if (failures.length > 0) {
    console.error(failures.join("\n\n"))
    process.exit(1)
  }

  console.log(`Commit messages parse for release-please (${candidates.length} checked).`)
}

main()
