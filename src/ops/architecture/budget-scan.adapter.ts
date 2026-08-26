import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  coveredBy,
  PATTERN_BUDGETS,
  PRODUCTION_EXCLUDES,
  type ModuleMeasurement,
  type PatternBudget,
  type PatternMeasurement,
} from "./budget"

const SOURCE_EXTENSIONS = [".ts", ".tsx"]

const isProductionSource = (relativePath: string): boolean =>
  SOURCE_EXTENSIONS.some((ext) => relativePath.endsWith(ext))
  && !PRODUCTION_EXCLUDES.some((excluded) => relativePath.includes(excluded))

/** Matches `wc -l`: the number of newline characters, so manifest pins are comparable to a shell measurement. */
const countLines = (contents: string): number => {
  let lines = 0
  for (let i = 0; i < contents.length; i += 1) if (contents[i] === "\n") lines += 1
  return lines
}

function listProductionSources(root: string, directory: string): string[] {
  const absolute = path.join(root, directory)
  const found: string[] = []
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relativePath = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...listProductionSources(root, relativePath))
    else if (isProductionSource(relativePath)) found.push(relativePath)
  }
  return found
}

export function measureModules(root: string, directory = "src"): ModuleMeasurement[] {
  return listProductionSources(root, directory)
    .map((relativePath) => ({
      path: relativePath,
      lines: countLines(readFileSync(path.join(root, relativePath), "utf8")),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Counts matching LINES, not matching occurrences, so a pin stays comparable to
 * the `grep -c` a reviewer will run to check it by hand.
 */
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
