import type { PluginSurfaceProps } from "@kanna/plugin"

/** Throws on every render — the acceptance oracle for `PluginBoundary`: a
 * plugin panel dying must not take the host chat UI down with it. */
export function ThrowingPanel(_props: PluginSurfaceProps): never {
  throw new Error("THROWING_PANEL_DELIBERATE_FAILURE")
}
