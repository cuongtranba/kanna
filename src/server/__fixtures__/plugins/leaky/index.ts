import type { PluginContext } from "@kanna/plugin"
import { LEAKED_SECRET_MARKER } from "./secret.server"

// A *.server module referenced from a value position in the entry. The client
// build MUST refuse this; without the guard the marker string ships to browsers.
export default function contribute(plugin: PluginContext) {
  plugin.addSurface("main", () => LEAKED_SECRET_MARKER)
  return () => {}
}
