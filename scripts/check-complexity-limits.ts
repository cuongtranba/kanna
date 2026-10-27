import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { type OxlintConfig } from "oxlint"
import { lintConfig } from "../lint.config"
import { LINT_LIMIT_PINS, PRODUCTION_EXCLUDES } from "../src/ops/architecture/budget"
import { runOxlint } from "../src/ops/lint/oxlint-run.adapter"

const ROOT = path.resolve(import.meta.dirname, "..")
const PROBE_CONFIG = path.join(ROOT, ".lint-limits-probe.json")

const isProduction = (filePath: string): boolean =>
  !PRODUCTION_EXCLUDES.some((excluded) => filePath.includes(excluded))

const probeConfig: OxlintConfig = {
  plugins: [],
  categories: { correctness: "off" },
  jsPlugins: lintConfig.jsPlugins,
  ignorePatterns: lintConfig.ignorePatterns,
  rules: Object.fromEntries(LINT_LIMIT_PINS.map((pin) => [pin.rule, ["error", { max: pin.max - 1 }]])),
}

const reached = new Set<string>()
try {
  writeFileSync(PROBE_CONFIG, JSON.stringify(probeConfig))
  for (const diagnostic of runOxlint(ROOT, ["-c", PROBE_CONFIG, "src/"])) {
    if (isProduction(diagnostic.filename)) reached.add(diagnostic.rule)
  }
} finally {
  rmSync(PROBE_CONFIG, { force: true })
}

const slack = LINT_LIMIT_PINS.filter((pin) => !reached.has(pin.rule))
if (slack.length === 0) {
  console.log(`All ${LINT_LIMIT_PINS.length} lint ceilings are tight.`)
  process.exit(0)
}

for (const pin of slack) {
  console.error(
    `"${pin.rule}" is pinned at ${pin.max} but nothing in production reaches ${pin.max - 1}.\n`
    + `  The ceiling has gone slack — lower it in lint.config.ts AND in LINT_LIMIT_PINS\n`
    + `  (src/ops/architecture/budget.ts) so the gain is locked in. Bisect by lowering\n`
    + `  COMPLEXITY_CEILINGS["${pin.rule}"] and running \`bun run lint\`.\n`,
  )
}
process.exit(1)
