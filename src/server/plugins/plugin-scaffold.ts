/**
 * The minimal working plugin skeleton `plugin_scaffold` writes.
 *
 * Pure: it returns file paths and contents, and never touches the disk —
 * `plugin-scaffold.adapter.ts` is the only thing that writes them (side-effect
 * seal). Keeping the templates here means the shape of a generated plugin is
 * unit-testable without a temp directory, and the adapter stays a leaf that
 * wraps `Bun.write` and nothing else.
 *
 * The skeleton is deliberately the same shape as the `hello` acceptance
 * fixture (`src/server/__fixtures__/plugins/hello`): a manifest, a `.ts` entry
 * whose default export is the `contribute` function, and one `.client.tsx`
 * surface. That shape is what the compile pipeline
 * (`plugin-build.adapter.ts`) is proven against, so a freshly scaffolded
 * plugin compiles under `plugin_validate` without the author editing anything
 * first. Every bare specifier it imports is on the client ABI
 * (`CLIENT_HOST_MODULES`) — `@kanna/plugin` is imported type-only, so it is
 * erased before the bundler ever sees it.
 */

import { KANNA_PLUGIN_API_VERSION, KANNA_PLUGIN_MANIFEST_FILENAME } from "../../shared/plugins/manifest"

/** One file of the skeleton. `path` is relative to the target directory. */
export interface PluginScaffoldFile {
  readonly path: string
  readonly contents: string
}

/** The entry `resolvePluginEntry(null)` resolves to, so the manifest can omit `entry`. */
const ENTRY_FILENAME = "index.ts"
const SURFACE_FILENAME = "panel.client.tsx"

/** The scaffolded plugin's own version, not the host ABI version. */
const INITIAL_PLUGIN_VERSION = "0.1.0"

function manifestContents(id: string, name: string): string {
  return `${JSON.stringify(
    { id, name, version: INITIAL_PLUGIN_VERSION, kannaPluginApi: KANNA_PLUGIN_API_VERSION },
    null,
    2,
  )}\n`
}

function entryContents(name: string): string {
  return [
    'import type { PluginContext } from "@kanna/plugin"',
    'import { Panel } from "./panel.client"',
    "",
    "export default function contribute(plugin: PluginContext) {",
    '  plugin.addSurface("main", Panel)',
    `  plugin.addSidebarItem({ id: "main", title: ${JSON.stringify(name)}, icon: "Blocks", surface: "main" })`,
    "  // Returned teardown runs when the plugin is stopped or reloaded.",
    "  return () => {}",
    "}",
    "",
  ].join("\n")
}

function surfaceContents(name: string): string {
  return [
    'import type { PluginSurfaceProps } from "@kanna/plugin"',
    "",
    "export function Panel({ theme }: PluginSurfaceProps) {",
    "  return (",
    "    <div style={{ color: theme.colors.foreground }}>",
    `      {${JSON.stringify(`${name} is running.`)}}`,
    "    </div>",
    "  )",
    "}",
    "",
  ].join("\n")
}

/**
 * Build the skeleton for a plugin id. `name` is the human label written into
 * the manifest and rendered by the surface; callers pass the id when the
 * author gave none, so the generated plugin is never nameless.
 */
export function buildPluginScaffoldFiles(id: string, name: string): readonly PluginScaffoldFile[] {
  return [
    { path: KANNA_PLUGIN_MANIFEST_FILENAME, contents: manifestContents(id, name) },
    { path: ENTRY_FILENAME, contents: entryContents(name) },
    { path: SURFACE_FILENAME, contents: surfaceContents(name) },
  ]
}
