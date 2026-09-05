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

export async function evaluatePluginModuleFromUrl({
  url,
  registry,
  pluginId,
}: EvaluatePluginModuleFromUrlArgs): Promise<PluginModule> {
  return importWithHostRegistry(url, registry, pluginId)
}
