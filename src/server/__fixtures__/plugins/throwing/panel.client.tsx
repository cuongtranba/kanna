import type { PluginSurfaceProps } from "@kanna/plugin"

export function ThrowingPanel(_props: PluginSurfaceProps): never {
  throw new Error("THROWING_PANEL_DELIBERATE_FAILURE")
}
