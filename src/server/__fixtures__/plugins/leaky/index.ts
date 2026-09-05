import type { PluginContext } from "@kanna/plugin"
import { LEAKED_SECRET_MARKER } from "./secret.server"

export default function contribute(plugin: PluginContext) {
  plugin.addSurface("main", () => LEAKED_SECRET_MARKER)
  return () => {}
}
