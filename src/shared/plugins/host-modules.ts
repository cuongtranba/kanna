/**
 * The plugin compiler ABI: the exact set of bare module specifiers a plugin's
 * client/server bundle may import, and nothing else. This is the ONE source
 * for three consumers that must never drift — `plugin-build.adapter.ts`'s
 * `external`/allowlist, the client `hostModuleRegistry`'s registry keys, and
 * the refusal message shown for anything off the list.
 *
 * Matching is EXACT, not prefix: `@kanna/plugin` and `@kanna/plugin/server`
 * are deliberately two separate entries, one per side, so a plugin cannot
 * reach server-only capability (`defineRpc`'s handler wiring) from client
 * code by importing a subpath of an otherwise-allowed package name.
 */
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
