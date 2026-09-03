import type { PluginContext } from "@kanna/plugin"
import { ThrowingPanel } from "./panel.client"

export default function contribute(plugin: PluginContext) {
  plugin.addSurface("main", ThrowingPanel)
  plugin.addSidebarItem({ id: "main", title: "Throwing", icon: "Blocks", surface: "main" })
  return () => {}
}
