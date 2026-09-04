/**
 * The one `PluginService` instance a Kanna process owns.
 *
 * `PLUGIN-SYSTEM-PLAN.md`'s P10 note is explicit that the CLI and MCP call
 * sites must "drive the same service methods" rather than each build their own
 * wiring. The HTTP surface has the same requirement for a stronger reason: a
 * second service would keep a SECOND registry, so a plugin installed over HTTP
 * would be invisible to `plugin_list`, and `reload` would restart a child that
 * no other surface could see.
 *
 * Lazy rather than constructed at boot: `createPluginService()` reads
 * `homedir()` and the CLI process must be able to build one without the server
 * having started. Holding module state is not an IO side effect, so this file
 * needs no `.adapter.ts` suffix — the IO lives in `plugin-service-io.adapter.ts`.
 */

import { createPluginService, type InstalledPluginStore, type PluginService } from "./plugin-service"

let instance: PluginService | null = null
let installedStore: InstalledPluginStore | null = null

/**
 * Give the process's service a durable home for its install records, and
 * re-register whatever is already there.
 *
 * Called once at boot, BEFORE anything asks for the service. Without it the
 * registry is in-memory only: an install vanishes on restart and a CLI install
 * is invisible to the running server, even though both wrote their bundles to
 * the same place on disk.
 */
export function configurePluginService(store: InstalledPluginStore): PluginService {
  installedStore = store
  instance = createPluginService({ installed: store })
  instance.restore()
  return instance
}

export function getPluginService(): PluginService {
  instance ??= createPluginService(installedStore ? { installed: installedStore } : {})
  return instance
}

/**
 * Swap the process-wide instance. Tests only — a suite that drives the HTTP,
 * CLI or MCP surface needs a service rooted at a temp `KANNA_HOME`, and must
 * restore `null` afterwards so it cannot leak into the next file.
 */
export function setPluginServiceForTest(service: PluginService | null): void {
  instance = service
  if (service === null) installedStore = null
}
