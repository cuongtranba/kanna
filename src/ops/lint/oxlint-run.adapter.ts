import { spawnSync } from "node:child_process"
import path from "node:path"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonValue } from "../../shared/json"

export interface OxlintDiagnostic {
  readonly rule: string
  readonly severity: string
  readonly message: string
  readonly filename: string
  readonly line: number
}

const RULE_CODE = /^([^(]+)\(([^)]+)\)$/

const stringField = (value: JsonValue | undefined): string => (typeof value === "string" ? value : "")

function lineOf(labels: JsonValue | undefined): number {
  if (!labels || !isJsonArray(labels)) return 0
  const first = labels[0]
  if (!first || !isJsonObject(first)) return 0
  const span = first.span
  if (!span || !isJsonObject(span)) return 0
  return typeof span.line === "number" ? span.line : 0
}

function diagnosticOf(entry: JsonValue): OxlintDiagnostic | null {
  if (!isJsonObject(entry)) return null
  const code = stringField(entry.code)
  const match = RULE_CODE.exec(code)
  return {
    rule: match ? `${match[1]}/${match[2]}` : code,
    severity: stringField(entry.severity),
    message: stringField(entry.message),
    filename: stringField(entry.filename),
    line: lineOf(entry.labels),
  }
}

export function parseOxlintJson(stdout: string): OxlintDiagnostic[] {
  const start = stdout.indexOf("{")
  const parsed = start < 0 ? null : safeJsonParse(stdout.slice(start))
  if (!parsed || !isJsonObject(parsed) || !parsed.diagnostics || !isJsonArray(parsed.diagnostics)) {
    throw new Error(`oxlint did not print its JSON report:\n${stdout.slice(0, 2_000)}`)
  }
  return parsed.diagnostics.flatMap((entry) => {
    const diagnostic = diagnosticOf(entry)
    return diagnostic ? [diagnostic] : []
  })
}

export function runOxlint(root: string, args: readonly string[]): OxlintDiagnostic[] {
  const result = spawnSync(path.join(root, "node_modules/.bin/vp"), ["lint", ...args, "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) throw result.error
  return parseOxlintJson(result.stdout)
}
