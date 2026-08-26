/**
 * Proves every ESLint complexity ceiling is still TIGHT.
 *
 * A ceiling nothing reaches gates nothing: if `complexity` is pinned at 141 but
 * the worst function is now 90, the rule silently stopped constraining anything
 * and 50 points of regression are available for free. This runs ESLint once with
 * every pinned ceiling lowered by one and requires each rule to report at least
 * one production violation — the analog of the budget's `pattern_shrank`, for a
 * measurement a regex cannot make.
 *
 * Reuses the budget's own PRODUCTION_EXCLUDES so "production" means one thing.
 */
import { ESLINT_LIMIT_PINS, PRODUCTION_EXCLUDES } from "../src/ops/architecture/budget"

interface EslintMessage {
  readonly ruleId: string | null
}
interface EslintResult {
  readonly filePath: string
  readonly messages: readonly EslintMessage[]
}

const isProduction = (filePath: string): boolean =>
  !PRODUCTION_EXCLUDES.some((excluded) => filePath.includes(excluded))

const probeRules = Object.fromEntries(
  ESLINT_LIMIT_PINS.map((pin) => [pin.rule, ["warn", { max: pin.max - 1 }]]),
)

const proc = Bun.spawn(
  ["npx", "eslint", "src/", "--rule", JSON.stringify(probeRules), "--format", "json"],
  { stdout: "pipe", stderr: "pipe" },
)
const raw = await new Response(proc.stdout).text()
await proc.exited

let results: readonly EslintResult[]
try {
  results = JSON.parse(raw) as readonly EslintResult[]
} catch {
  console.error("check:limits could not parse ESLint JSON output — refusing to report a pass it cannot prove.")
  console.error(raw.slice(0, 2_000))
  process.exit(1)
}

const reached = new Set<string>()
for (const result of results) {
  if (!isProduction(result.filePath)) continue
  for (const message of result.messages) {
    if (message.ruleId) reached.add(message.ruleId)
  }
}

const slack = ESLINT_LIMIT_PINS.filter((pin) => !reached.has(pin.rule))
if (slack.length === 0) {
  console.log(`All ${ESLINT_LIMIT_PINS.length} ESLint ceilings are tight.`)
  process.exit(0)
}

for (const pin of slack) {
  console.error(
    `"${pin.rule}" is pinned at ${pin.max} but nothing in production reaches ${pin.max - 1}.\n`
    + `  The ceiling has gone slack — lower it in eslint.config.js AND in ESLINT_LIMIT_PINS\n`
    + `  (src/ops/architecture/budget.ts) so the gain is locked in. Bisect with:\n`
    + `    npx eslint src/ --rule '{"${pin.rule}":["warn",{"max":N}]}'\n`,
  )
}
process.exit(1)
