/**
 * Evaluates a compiled plugin CLIENT bundle — the ESM text `buildPluginBundles`
 * (`../../server/plugins/plugin-build.adapter.ts`) produces — as a real ES
 * module.
 *
 * The bundle is genuine ESM (`import`/`export` syntax, its entry re-exports
 * `default`), so it can only run through native module evaluation:
 * `new Function` cannot contain a top-level `export` statement, and `eval`
 * was explicitly rejected when the compile pipeline's format was chosen
 * (PLUGIN-SYSTEM-PLAN.md's `Bun.build` ABI experiment — ESM + native
 * `import()`, no `eval`). A `Blob` + object-URL round-trip gives dynamic
 * `import()` a URL to load the in-memory text from; verified to resolve in
 * both `bun test` and a real browser.
 *
 * Every host-module bare specifier in the bundle was already rewritten at
 * build time into `globalThis.__KANNA_PLUGIN_HOST__.require(name)`, so the
 * only wiring left here is pointing that global at the caller's registry for
 * the duration of the import — confined to this call (save + restore in a
 * `finally`) because this runs inside the long-lived SPA process alongside
 * unrelated code that must never observe the mutation.
 */
import { type HostBag, type LoadedModule } from "../../shared/dynamic-module"
import { isRecord } from "../../shared/errors"
import type { createPluginHostRegistry } from "./hostModuleRegistry"

const HOST_GLOBAL_KEY = "__KANNA_PLUGIN_HOST__"

type HostGlobal = HostBag

export interface EvaluatePluginModuleArgs {
  readonly code: string
  readonly registry: ReturnType<typeof createPluginHostRegistry>
  readonly pluginId: string
}

export interface PluginModule {
  readonly default: (context: LoadedModule) => LoadedModule
}

function isPluginModule(value: LoadedModule): value is PluginModule {
  return isRecord(value) && typeof value.default === "function"
}

async function importWithHostRegistry(
  url: string,
  registry: EvaluatePluginModuleArgs["registry"],
  pluginId: string,
): Promise<PluginModule> {
  const host: HostGlobal = globalThis
  const hadPrevious = HOST_GLOBAL_KEY in host
  const previous = host[HOST_GLOBAL_KEY]
  host[HOST_GLOBAL_KEY] = registry

  try {
    const loaded: LoadedModule = await import(/* @vite-ignore */ url)
    if (!isPluginModule(loaded)) {
      throw new Error(`plugin "${pluginId}" compiled to a module with no default export`)
    }
    return loaded
  } finally {
    if (hadPrevious) host[HOST_GLOBAL_KEY] = previous
    else delete host[HOST_GLOBAL_KEY]
  }
}

export async function evaluatePluginModule({
  code,
  registry,
  pluginId,
}: EvaluatePluginModuleArgs): Promise<PluginModule> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
  try {
    return await importWithHostRegistry(url, registry, pluginId)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface EvaluatePluginModuleFromUrlArgs {
  readonly url: string
  readonly registry: EvaluatePluginModuleArgs["registry"]
  readonly pluginId: string
}

/**
 * Same evaluation, sourced from a URL the browser fetches itself — what the
 * running app uses against `GET /api/plugins/:id/client.js`. Going through the
 * network URL rather than fetching the text and re-wrapping it in a Blob keeps
 * the served sourcemap and the real module URL intact.
 *
 * The caller MUST cache-bust the URL. The browser's ESM registry is permanent
 * per URL, so a plain re-import after `POST /api/plugins/:id/reload` silently
 * re-runs the stale module.
 */
export async function evaluatePluginModuleFromUrl({
  url,
  registry,
  pluginId,
}: EvaluatePluginModuleFromUrlArgs): Promise<PluginModule> {
  return importWithHostRegistry(url, registry, pluginId)
}
