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
import { isRecord, type AnyValue } from "../../shared/errors"
import type { createPluginHostRegistry } from "./hostModuleRegistry"

const HOST_GLOBAL_KEY = "__KANNA_PLUGIN_HOST__"

type HostGlobal = Record<string, AnyValue>

export interface EvaluatePluginModuleArgs {
  readonly code: string
  readonly registry: ReturnType<typeof createPluginHostRegistry>
  readonly pluginId: string
}

export interface PluginModule {
  readonly default: (context: AnyValue) => AnyValue
}

function isPluginModule(value: AnyValue): value is PluginModule {
  return isRecord(value) && typeof value.default === "function"
}

export async function evaluatePluginModule({
  code,
  registry,
  pluginId,
}: EvaluatePluginModuleArgs): Promise<PluginModule> {
  const host: HostGlobal = globalThis
  const hadPrevious = HOST_GLOBAL_KEY in host
  const previous = host[HOST_GLOBAL_KEY]
  host[HOST_GLOBAL_KEY] = registry

  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }))
  try {
    const loaded: AnyValue = await import(/* @vite-ignore */ url)
    if (!isPluginModule(loaded)) {
      throw new Error(`plugin "${pluginId}" compiled to a module with no default export`)
    }
    return loaded
  } finally {
    URL.revokeObjectURL(url)
    if (hadPrevious) host[HOST_GLOBAL_KEY] = previous
    else delete host[HOST_GLOBAL_KEY]
  }
}
