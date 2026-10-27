import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { type OxlintConfig } from "oxlint"
import { lintConfig } from "../../../lint.config"
import { isRecord } from "../../shared/errors"
import {
  coveredBy,
  PATTERN_BUDGETS,
  PRODUCTION_EXCLUDES,
  TEST_SOURCE_SUFFIXES,
  type ModuleMeasurement,
  type PatternBudget,
  type PatternMeasurement,
} from "./budget"
import { countCloneBlocks, findLeakedLiterals, type SourceText } from "./duplication"

const SOURCE_EXTENSIONS = [".ts", ".tsx"]

const isProductionSource = (relativePath: string): boolean =>
  SOURCE_EXTENSIONS.some((ext) => relativePath.endsWith(ext))
  && !PRODUCTION_EXCLUDES.some((excluded) => relativePath.includes(excluded))

const isTestSource = (relativePath: string): boolean =>
  TEST_SOURCE_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))

const countLines = (contents: string): number => {
  let lines = 0
  for (let i = 0; i < contents.length; i += 1) if (contents[i] === "\n") lines += 1
  return lines
}

function listSources(root: string, directory: string, accepts: (relativePath: string) => boolean): string[] {
  const absolute = path.join(root, directory)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relativePath = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...listSources(root, relativePath, accepts))
    else if (accepts(relativePath)) found.push(relativePath)
  }
  return found
}

export const listProductionSources = (root: string, directory: string): string[] =>
  listSources(root, directory, isProductionSource)

const measureSources = (root: string, directory: string, accepts: (relativePath: string) => boolean): ModuleMeasurement[] =>
  listSources(root, directory, accepts)
    .map((relativePath) => ({
      path: relativePath,
      lines: countLines(readFileSync(path.join(root, relativePath), "utf8")),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))

export const measureModules = (root: string, directory = "src"): ModuleMeasurement[] =>
  measureSources(root, directory, isProductionSource)

export const measureTestSources = (root: string, directory = "src"): ModuleMeasurement[] =>
  measureSources(root, directory, isTestSource)

function measurePattern(root: string, sources: readonly ModuleMeasurement[], budget: PatternBudget): PatternMeasurement {
  const expression = new RegExp(budget.pattern)
  const sites: string[] = []
  let count = 0
  let filesScanned = 0

  for (const { path: relativePath } of sources) {
    if (!coveredBy(relativePath, budget.include)) continue
    filesScanned += 1
    const lines = readFileSync(path.join(root, relativePath), "utf8").split("\n")
    lines.forEach((line, index) => {
      if (!expression.test(line)) return
      count += 1
      if (sites.length < 5) sites.push(`${relativePath}:${index + 1}`)
    })
  }

  return { id: budget.id, count, sites, filesScanned }
}

export function measurePatterns(
  root: string,
  sources: readonly ModuleMeasurement[],
  budgets: readonly PatternBudget[] = PATTERN_BUDGETS,
): PatternMeasurement[] {
  return budgets.map((budget) => measurePattern(root, sources, budget))
}

type RuleSetting = NonNullable<OxlintConfig["rules"]>[string]

const limitOf = (setting: RuleSetting): number | null => {
  if (!Array.isArray(setting) || setting.length < 2) return null
  const option = setting[1]
  if (typeof option === "number") return option
  if (isRecord(option) && typeof option.max === "number") return option.max
  return null
}

export function readLintLimits(
  rules: readonly string[],
  config: OxlintConfig = lintConfig,
): ReadonlyMap<string, number> {
  const found = new Map<string, number>()
  const blocks = [config.rules, ...(config.overrides ?? []).map((override) => override.rules)]

  for (const blockRules of blocks) {
    if (!blockRules) continue
    for (const rule of rules) {
      const max = limitOf(blockRules[rule])
      if (max !== null) found.set(rule, max)
    }
  }

  return found
}

const SELF_QUOTING_PREFIX = "src/ops/architecture/"

export function measureDuplication(root: string, sources: readonly ModuleMeasurement[]): PatternMeasurement[] {
  const texts: SourceText[] = sources.map(({ path: relativePath }) => ({
    path: relativePath,
    text: readFileSync(path.join(root, relativePath), "utf8"),
  }))
  const clones = countCloneBlocks(texts)
  const leaked = findLeakedLiterals(texts.filter((source) => !source.path.startsWith(SELF_QUOTING_PREFIX)))
  return [
    { id: "leaked-protocol-literals", count: leaked.count, sites: leaked.sites, filesScanned: texts.length },
    { id: "code-clones", count: clones.count, sites: clones.sites, filesScanned: texts.length },
  ]
}
