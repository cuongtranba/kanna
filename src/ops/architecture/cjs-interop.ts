/**
 * cjs-interop.ts — the hard gate over CommonJS default-import interop in the client bundle.
 *
 * Vite 8 replaced rollup with rolldown, and rolldown resolves `import x from "<cjs-pkg>"`
 * with NODE semantics: `x = module.exports`. rollup and esbuild's browser interop instead
 * honour the `__esModule` marker and bind `x = module.exports.default`. For a package that
 * is plain CommonJS (`module.exports = fn`) the two agree. For a TypeScript-TRANSPILED
 * CommonJS package — `__esModule: true` plus an own `default` export — they disagree, and
 * the rolldown binding is an object where the code expects a function.
 *
 * Nothing catches that. It type-checks (the `.d.ts` describes the ESM shape), it lints, it
 * builds, and every unit test passes because bun's loader honours `__esModule` too. It fails
 * only in a real browser, against a real production bundle, as
 * `TypeError: (0, Lr.default) is not a function` — and because these imports sit in hooks at
 * the App root, the failure is a white screen rather than a degraded feature.
 *
 * The gate is a pattern over source, not over the bundle: a minified chunk cannot tell an
 * app-code `.default` call from one inside a vendored CommonJS factory, whereas the import
 * statement that causes it is unambiguous. It classifies each imported package by the same
 * predicate rolldown's `__toESM` helper uses — `mod.__esModule && hasOwnProperty(mod, "default")`
 * — so a package only fails when the two interops genuinely disagree about it.
 *
 * `src/ops/**` is outside the side-effect seal, but the split is kept anyway: this module is
 * pure and `cjs-interop-scan.adapter.ts` is the only file that touches the filesystem.
 */

/** Source roots rolldown bundles for the browser. `src/server/**` runs under bun and is exempt. */
export const BUNDLED_ROOTS: readonly string[] = ["src/client/", "src/shared/"]

/** How a package's default export behaves under the two interops. */
export type PackageInterop =
  /** Real ESM, or CommonJS that both interops agree on. A default import is safe. */
  | { kind: "safe"; reason: string }
  /** `__esModule` + an own `default`: rolldown binds the namespace, everything else binds the hook. */
  | { kind: "transpiled_cjs"; reason: string }
  /** Neither require nor a static read could answer. Never treated as safe. */
  | { kind: "unknown"; reason: string }

/** How a file takes hold of a package's default export. */
export type BindingKind =
  /** `import x from "p"`, `import x, {y} from "p"`, or `import {default as x} from "p"`. */
  | "default"
  /** `import * as ns from "p"` where the file then reads `ns.default`. */
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

/**
 * The one file allowed to default-import a transpiled-CommonJS package, because resolving the
 * binding at runtime is the whole point of it. Every entry needs a reason; an entry that stops
 * matching a real import is a breach, so the allowlist cannot outlive the import it covers.
 */
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
  /** A default import that rolldown and every other bundler bind differently. */
  | { kind: "cjs_default_import"; path: string; line: number; specifier: string; local: string; binding: BindingKind; reason: string }
  /** A package the scan could not classify. Reported rather than assumed safe. */
  | { kind: "unclassified_package"; path: string; line: number; specifier: string; reason: string }
  /** An allowlist entry matching no import in the tree. Delist it. */
  | { kind: "sanction_stale"; path: string; specifier: string }
  /** The scan reached no source at all — an inert gate, never a clean tree. */
  | { kind: "scan_empty"; roots: readonly string[] }

const isBareSpecifier = (specifier: string): boolean =>
  specifier.length > 0 && !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("node:")

/** `@scope/name/sub` -> `@scope/name`; `name/sub` -> `name`. */
export function packageNameOf(specifier: string): string {
  const segments = specifier.split("/")
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? specifier)
}

/**
 * Anchored to the start of a line, which is where every top-level import statement sits.
 * Without the anchor the gate matches its own prose: a comment warning "do not write
 * `import x from "pkg"`" reads as the very import it forbids, and so does a commented-out
 * line. Excluding quotes from the clause stops a lazy multi-line match from stepping over a
 * side-effect import (`import "./a.css"`) to reach the next statement's `from`.
 */
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

/**
 * Finds every import that takes hold of a package's DEFAULT export.
 *
 * A namespace import is only a site when the file actually reads `.default` off it — otherwise
 * every `import * as React from "react"` would be a finding, and named access through a
 * namespace is copied faithfully by both interops.
 */
export function findDefaultImports(path: string, source: string): DefaultImportSite[] {
  const sites: DefaultImportSite[] = []

  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    const [, rawClause = "", specifier = ""] = match
    if (!isBareSpecifier(specifier)) continue

    const clause = rawClause.trim()
    // `import type X from "p"` is erased before the bundler ever sees it.
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
  // A gate whose scan resolved nothing would otherwise report a clean tree forever.
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
