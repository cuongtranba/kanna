export const PLUGIN_HOST_GLOBAL = "__KANNA_PLUGIN_HOST__"

export type PluginHostTarget = "client" | "server"

export const CLIENT_HOST_MODULES: readonly string[] = [
  "@kanna/plugin",
  "react",
  "react/jsx-runtime",
  "@tanstack/react-query",
  "zod",
]

export const PLUGIN_CLIENT_CONTRIBUTION_METHODS = ["addSurface", "addSidebarItem", "addCommandCenterItem"] as const

export type PluginClientContributionMethod = (typeof PLUGIN_CLIENT_CONTRIBUTION_METHODS)[number]

export function hostModuleUnavailableMessage(name: string, target: PluginHostTarget): string {
  return `Module "${name}" is not available in plugin ${target} code`
}
