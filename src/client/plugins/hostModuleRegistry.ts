/**
 * The client half of the plugin host-module bridge (see
 * `../../shared/plugins/host-modules.ts` for the ABI this implements).
 *
 * A compiled plugin CLIENT bundle never has its own copy of `react` et al. —
 * `plugin-build.adapter.ts`'s `hostModulePlugin` rewrites every bare import
 * of a name in `CLIENT_HOST_MODULES` into
 * `globalThis.__KANNA_PLUGIN_HOST__.require(name)`. This registry is what
 * answers that call, and it MUST hand back the host app's own already-loaded
 * module instance rather than a fresh one: a second `react` copy throws
 * "Invalid hook call" the moment plugin code calls a hook, because hooks are
 * keyed off React's own module-scoped dispatcher state. A plain `import()`
 * of the same specifier the rest of the app uses is what gives identity —
 * module resolution caches by resolved path, so this file's `react` import
 * and the app shell's `react` import are the same object.
 */
import * as reactQueryModule from "@tanstack/react-query"
import * as reactModule from "react"
import * as reactJsxRuntimeModule from "react/jsx-runtime"
import * as zodModule from "zod"
import { type AnyValue } from "../../shared/errors"
import { CLIENT_HOST_MODULES, hostModuleUnavailableMessage } from "../../shared/plugins/host-modules"

// `@kanna/plugin` carries no client runtime today — plugin code only ever
// imports TYPES from it (`import type { PluginContext, ... }`), which the
// compiler elides, so nothing has called `require("@kanna/plugin")` yet.
// Reserved in the ABI (and here) for the runtime helpers a later P5/P6-UI
// chunk adds (theme access, contribution registry hooks).
const KANNA_PLUGIN_RUNTIME: Readonly<Record<string, AnyValue>> = {}

const HOST_MODULE_INSTANCES: Readonly<Record<string, AnyValue>> = {
  "@kanna/plugin": KANNA_PLUGIN_RUNTIME,
  react: reactModule,
  "react/jsx-runtime": reactJsxRuntimeModule,
  "@tanstack/react-query": reactQueryModule,
  zod: zodModule,
}

export interface PluginHostRegistry {
  require(name: string): AnyValue
}

export function createPluginHostRegistry(): PluginHostRegistry {
  return {
    require(name: string): AnyValue {
      if (!CLIENT_HOST_MODULES.includes(name) || !(name in HOST_MODULE_INSTANCES)) {
        throw new Error(hostModuleUnavailableMessage(name))
      }
      return HOST_MODULE_INSTANCES[name]
    },
  }
}
