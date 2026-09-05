import * as reactQueryModule from "@tanstack/react-query"
import * as reactModule from "react"
import * as reactJsxRuntimeModule from "react/jsx-runtime"
import * as zodModule from "zod"
import { type LoadedModule } from "../../shared/dynamic-module"
import { CLIENT_HOST_MODULES, hostModuleUnavailableMessage } from "../../shared/plugins/host-modules"

const KANNA_PLUGIN_RUNTIME: Readonly<Record<string, LoadedModule>> = {}

const HOST_MODULE_INSTANCES: Readonly<Record<string, LoadedModule>> = {
  "@kanna/plugin": KANNA_PLUGIN_RUNTIME,
  react: reactModule,
  "react/jsx-runtime": reactJsxRuntimeModule,
  "@tanstack/react-query": reactQueryModule,
  zod: zodModule,
}

export interface PluginHostRegistry {
  require(name: string): LoadedModule
}

export function createPluginHostRegistry(): PluginHostRegistry {
  return {
    require(name: string): LoadedModule {
      if (!CLIENT_HOST_MODULES.includes(name) || !(name in HOST_MODULE_INSTANCES)) {
        throw new Error(hostModuleUnavailableMessage(name))
      }
      return HOST_MODULE_INSTANCES[name]
    },
  }
}
