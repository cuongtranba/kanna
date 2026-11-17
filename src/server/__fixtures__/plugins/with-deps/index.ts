import type { PluginContext } from "@kanna/plugin"
import { CLIENT_PKG_MARKER, shout } from "kanna-fixture-client-pkg"
import { roundTrip } from "./compress.server"
import { compress } from "./compress.shared"

export default function contribute(plugin: PluginContext) {
  plugin.handle(compress, roundTrip)
  plugin.addCommandCenterItem({ name: "shout", description: shout("shout"), prompt: CLIENT_PKG_MARKER })
  return () => {}
}
