import type { PluginContext } from "@kanna/plugin"
import { HelloPanel } from "./panel.client"
import { createGreeting } from "./greeting.server"
import { greeting } from "./greeting.shared"

export default function contribute(plugin: PluginContext) {
  plugin.handle(greeting, createGreeting)
  plugin.addSurface("main", HelloPanel)
  plugin.addSidebarItem({ id: "main", title: "Hello", icon: "Blocks", surface: "main" })
  return () => {}
}
