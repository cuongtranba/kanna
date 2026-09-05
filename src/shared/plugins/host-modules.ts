export const CLIENT_HOST_MODULES: readonly string[] = [
  "@kanna/plugin",
  "react",
  "react/jsx-runtime",
  "@tanstack/react-query",
  "zod",
]

export const SERVER_HOST_MODULES: readonly string[] = ["@kanna/plugin/server", "zod"]

export function hostModuleUnavailableMessage(name: string): string {
  return `Module "${name}" is not available in plugin client code`
}
