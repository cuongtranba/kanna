
export const BUNDLED_ROOTS: readonly string[] = ["src/client/", "src/shared/"]

export type PackageInterop =
  | { kind: "safe"; reason: string }
  | { kind: "transpiled_cjs"; reason: string }
  | { kind: "unknown"; reason: string }

export type BindingKind =
  | "default"
  | "namespace_default"

export interface DefaultImportSite {
  readonly path: string
  readonly line: number
  readonly specifier: string
  readonly local: string
  readonly binding: BindingKind
}

export interface ClassifiedImport extends DefaultImportSite {
  readonly interop: PackageInterop
}

export interface SanctionedInterop {
  readonly path: string
  readonly specifier: string
  readonly reason: string
}

export const SANCTIONED_INTEROP: readonly SanctionedInterop[] = [
  {
    path: "src/client/lib/useWebSocket.ts",
    specifier: "react-use-websocket",
    reason:
      "Sole chokepoint: reads `.default` off the binding and falls back to the binding itself, "
      + "so the hook resolves correctly under both rolldown and __esModule-aware interop.",
  },
]

export type InteropBreach =
  | { kind: "cjs_default_import"; path: string; line: number; specifier: string; local: string; binding: BindingKind; reason: string }
  | { kind: "unclassified_package"; path: string; line: number; specifier: string; reason: string }
  | { kind: "sanction_stale"; path: string; specifier: string }
  | { kind: "scan_empty"; roots: readonly string[] }

const isBareSpecifier = (specifier: string): boolean =>
  specifier.length > 0 && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:")

export function packageNameOf(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

const IMPORT_STATEMENT = /^[ \t]*import\s+((?:type\s+)?[^;'"]*?)\s+from\s*["']([^"']+)["']/gm
const NAMESPACE_CLAUSE = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/
const DEFAULT_AS_CLAUSE = /\{[^}]*\bdefault\s+as\s+([A-Za-z_$][\w$]*)/
const LEADING_DEFAULT_CLAUSE = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/

const lineOf = (source: string, index: number): number => {
  let line = 1
  for (let i = 0; i < index; i += 1) if (source[i] === "\n") line += 1
  return line
}

const readsDefaultProperty = (source: string, local: string): boolean =>
  new RegExp(`\\b${local}\\.default\\b`).test(source)

export function findDefaultImports(path: string, source: string): DefaultImportSite[] {
  const sites: DefaultImportSite[] = []

  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    const [, rawClause = "", specifier = ""] = match
    if (!isBareSpecifier(specifier)) continue

    const clause = rawClause.trim()
    if (clause.startsWith("type ")) continue

    const line = lineOf(source, match.index ?? 0)
    const site = (local: string, binding: BindingKind): DefaultImportSite =>
      ({ path, line, specifier, local, binding })

    const namespace = NAMESPACE_CLAUSE.exec(clause)
    if (namespace?.[1]) {
      if (readsDefaultProperty(source, namespace[1])) sites.push(site(namespace[1], "namespace_default"))
      continue
    }

    const renamedDefault = DEFAULT_AS_CLAUSE.exec(clause)
    if (renamedDefault?.[1]) {
      sites.push(site(renamedDefault[1], "default"))
      continue
    }

    const leadingDefault = LEADING_DEFAULT_CLAUSE.exec(clause)
    if (leadingDefault?.[1]) sites.push(site(leadingDefault[1], "default"))
  }

  return sites
}

export const isSanctioned = (
  site: DefaultImportSite,
  sanctioned: readonly SanctionedInterop[] = SANCTIONED_INTEROP,
): boolean =>
  sanctioned.some((entry) => entry.path === site.path && entry.specifier === site.specifier)

export function checkCjsInterop(
  imports: readonly ClassifiedImport[],
  filesScanned: number,
  sanctioned: readonly SanctionedInterop[] = SANCTIONED_INTEROP,
): InteropBreach[] {
  if (filesScanned === 0) return [{ kind: "scan_empty", roots: BUNDLED_ROOTS }]

  const breaches: InteropBreach[] = []

  for (const site of imports) {
    if (site.interop.kind === "safe") continue
    if (isSanctioned(site, sanctioned)) continue
    breaches.push(
      site.interop.kind === "transpiled_cjs"
        ? { kind: "cjs_default_import", path: site.path, line: site.line, specifier: site.specifier, local: site.local, binding: site.binding, reason: site.interop.reason }
        : { kind: "unclassified_package", path: site.path, line: site.line, specifier: site.specifier, reason: site.interop.reason },
    )
  }

  for (const entry of sanctioned) {
    const covers = imports.some((site) => site.path === entry.path && site.specifier === entry.specifier)
    if (!covers) breaches.push({ kind: "sanction_stale", path: entry.path, specifier: entry.specifier })
  }

  return breaches
}

const REMEDY = [
  "Fix it by importing the NAMED binding instead, or by routing the default through a single",
  "documented chokepoint that reads `mod.default ?? mod` and adding that one file to",
  "SANCTIONED_INTEROP in src/ops/architecture/cjs-interop.ts.",
].join(" ")

export function formatInteropBreach(breach: InteropBreach): string {
  switch (breach.kind) {
    case "cjs_default_import":
      return [
        `${breach.path}:${breach.line} default-imports "${breach.specifier}" as \`${breach.local}\``
        + `${breach.binding === "namespace_default" ? " (read as `.default` off a namespace import)" : ""}.`,
        `${breach.specifier} is ${breach.reason}, so rolldown binds it to \`module.exports\` while`,
        "every other bundler binds it to `module.exports.default`. In a production build the value is",
        "an object where the code expects a function, and the browser throws",
        '"(0, X.default) is not a function" — a white screen, not a degraded feature.',
        REMEDY,
      ].join("\n")
    case "unclassified_package":
      return [
        `${breach.path}:${breach.line} default-imports "${breach.specifier}", which this gate could not`,
        `classify (${breach.reason}). An unclassified package is NOT assumed safe: rolldown may bind its`,
        "default to `module.exports`. Confirm the package ships ESM, or route it through a chokepoint.",
        REMEDY,
      ].join("\n")
    case "sanction_stale":
      return [
        `SANCTIONED_INTEROP still allows "${breach.specifier}" in ${breach.path}, but no such import`,
        "exists any more. Delete the entry — a sanction left behind is a hole the next default import",
        "falls straight through.",
      ].join("\n")
    case "scan_empty":
      return [
        `The CommonJS interop gate scanned no files under ${breach.roots.join(", ")}, so it is currently`,
        "inert and would pass whatever the tree contains. Fix the scan roots; do NOT treat this as clean.",
      ].join("\n")
  }
}
