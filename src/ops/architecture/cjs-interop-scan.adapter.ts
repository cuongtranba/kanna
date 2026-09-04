import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { type LoadedModule } from "../../shared/dynamic-module"
import { isRecord } from "../../shared/errors"
import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import { PRODUCTION_EXCLUDES } from "./budget"
import {
  BUNDLED_ROOTS,
  findDefaultImports,
  packageNameOf,
  type ClassifiedImport,
  type DefaultImportSite,
  type PackageInterop,
} from "./cjs-interop"

const SOURCE_EXTENSIONS = [".ts", ".tsx"]

const isProductionSource = (relativePath: string): boolean =>
  SOURCE_EXTENSIONS.some((ext) => relativePath.endsWith(ext))
  && !PRODUCTION_EXCLUDES.some((excluded) => relativePath.includes(excluded))

function listSources(root: string, directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relativePath = path.posix.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...listSources(root, relativePath))
    else if (isProductionSource(relativePath)) found.push(relativePath)
  }
  return found
}

export interface ScanResult {
  readonly imports: readonly ClassifiedImport[]
  readonly filesScanned: number
}

/** True when the package publishes an ESM entry, which is what Vite prefers for the browser. */
function declaresEsmEntry(manifest: JsonObject): boolean {
  if (manifest.type === "module") return true
  if (typeof manifest.module === "string") return true
  return hasEsmCondition(manifest.exports)
}

function hasEsmCondition(exportsField: JsonValue): boolean {
  if (!isJsonObject(exportsField)) return false
  for (const [key, value] of Object.entries(exportsField)) {
    if ((key === "import" || key === "module") && value !== null && value !== undefined) return true
    if (hasEsmCondition(value)) return true
  }
  return false
}

/**
 * Applies rolldown's own `__toESM` predicate: the two interops disagree exactly when the
 * loaded module carries `__esModule` AND an own `default`. Requiring the package answers
 * that precisely — `Object.defineProperty(exports, "default", ...)`, the shape TypeScript
 * emits, is invisible to any regex over the entry text.
 */
function classifyLoadedModule(loaded: LoadedModule): PackageInterop {
  const isTranspiled = isRecord(loaded)
    && loaded.__esModule === true
    && Object.prototype.hasOwnProperty.call(loaded, "default")
  return isTranspiled
    ? { kind: "transpiled_cjs", reason: "CommonJS carrying `__esModule` and an own `default` export" }
    : { kind: "safe", reason: "CommonJS whose default binding is `module.exports` under either interop" }
}

/**
 * Fallback for a package that cannot be required in this process (browser globals at import
 * time, native bindings). Reads the resolved entry instead. Weaker than loading it, so a file
 * that shows neither marker is reported `unknown` rather than waved through.
 */
function classifyEntryText(entryPath: string): PackageInterop {
  const source = readFileSync(entryPath, "utf8")
  const marksEsModule = source.includes("__esModule")
  const exportsDefault = /exports\s*(?:\.default\s*=|\[["']default["']\]\s*=)/.test(source)
    || /defineProperty\(\s*exports\s*,\s*["']default["']/.test(source)
  if (marksEsModule && exportsDefault) {
    return { kind: "transpiled_cjs", reason: "CommonJS carrying `__esModule` and an own `default` export" }
  }
  if (!marksEsModule) {
    return { kind: "safe", reason: "CommonJS with no `__esModule` marker, so both interops bind `module.exports`" }
  }
  return { kind: "unknown", reason: `could not be loaded, and ${entryPath} is inconclusive` }
}

function classifyPackage(require: NodeRequire, root: string, specifier: string): PackageInterop {
  const manifestPath = resolveManifest(require, root, specifier)
  if (!manifestPath) return { kind: "unknown", reason: "its package.json could not be resolved" }

  const manifest: JsonValue = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (isJsonObject(manifest) && declaresEsmEntry(manifest)) {
    return { kind: "safe", reason: "publishes an ESM entry, so the default export is a real ESM default" }
  }

  try {
    return classifyLoadedModule(require(specifier))
  } catch {
    try {
      return classifyEntryText(require.resolve(specifier))
    } catch (error) {
      return { kind: "unknown", reason: `neither require nor resolve succeeded (${String(error)})` }
    }
  }
}

/** `require.resolve` follows an `exports` map that may not expose `package.json`, so fall back to node_modules. */
function resolveManifest(require: NodeRequire, root: string, specifier: string): string | null {
  const packageName = packageNameOf(specifier)
  try {
    return require.resolve(`${packageName}/package.json`)
  } catch {
    const candidate = path.join(root, "node_modules", packageName, "package.json")
    try {
      readFileSync(candidate, "utf8")
      return candidate
    } catch {
      return null
    }
  }
}

export function scanCjsInterop(root: string, roots: readonly string[] = BUNDLED_ROOTS): ScanResult {
  const require = createRequire(path.join(root, "package.json"))
  const cache = new Map<string, PackageInterop>()
  const imports: ClassifiedImport[] = []
  let filesScanned = 0

  for (const directory of roots) {
    for (const relativePath of listSources(root, directory.replace(/\/$/, ""))) {
      filesScanned += 1
      const source = readFileSync(path.join(root, relativePath), "utf8")
      for (const site of findDefaultImports(relativePath, source)) {
        imports.push({ ...site, interop: classify(cache, require, root, site) })
      }
    }
  }

  return { imports, filesScanned }
}

function classify(
  cache: Map<string, PackageInterop>,
  require: NodeRequire,
  root: string,
  site: DefaultImportSite,
): PackageInterop {
  const cached = cache.get(site.specifier)
  if (cached) return cached
  const interop = classifyPackage(require, root, site.specifier)
  cache.set(site.specifier, interop)
  return interop
}
