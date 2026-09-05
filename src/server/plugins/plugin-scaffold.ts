
import { KANNA_PLUGIN_API_VERSION, KANNA_PLUGIN_MANIFEST_FILENAME } from "../../shared/plugins/manifest"

export interface PluginScaffoldFile {
  readonly path: string
  readonly contents: string
}

const ENTRY_FILENAME = "index.ts"
const SURFACE_FILENAME = "panel.client.tsx"

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

export function buildPluginScaffoldFiles(id: string, name: string): readonly PluginScaffoldFile[] {
  return [
    { path: KANNA_PLUGIN_MANIFEST_FILENAME, contents: manifestContents(id, name) },
    { path: ENTRY_FILENAME, contents: entryContents(name) },
    { path: SURFACE_FILENAME, contents: surfaceContents(name) },
  ]
}
