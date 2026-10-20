import type { McpSource, McpSourcesSnapshot } from "../../shared/mcp-sources/types"
import type { AppSettingsManager } from "../app-settings"
import type { InboundDeliveryAgent, InboundDeliveryStore } from "../inbound/deliver-inbound"
import { deliverInbound } from "../inbound/deliver-inbound"
import type { InboxRegistry } from "../inbox/inbox-registry"
import { resolveMcpBearer } from "../mcp-bearer"
import type { BusSink } from "../service-bus/service-bus"
import { createMcpSourceConnector } from "./mcp-source-client.adapter"
import { createFileMcpSourceCursorStore } from "./mcp-source-cursor-store.adapter"
import { McpSourceRunner, type McpSourceClock } from "./mcp-source-runner"

export interface McpSourcesRuntime {
  snapshot(): McpSourcesSnapshot
  onStatus(listener: () => void): () => void
  sources(): readonly McpSource[]
  stop(): Promise<void>
}

export type McpSourcesTopic = Pick<McpSourcesRuntime, "snapshot" | "onStatus" | "stop">

const realClock: McpSourceClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    }),
}

export function startMcpSources(
  appSettings: AppSettingsManager,
  store: InboundDeliveryStore & { dataDir: string },
  agent: InboundDeliveryAgent,
  bus: BusSink,
  inbox: InboxRegistry,
): McpSourcesRuntime {
  const runner = new McpSourceRunner(
    createMcpSourceConnector(),
    createFileMcpSourceCursorStore(store.dataDir),
    (server) => resolveMcpBearer(server, appSettings),
    (delivery) => deliverInbound(store, agent, bus, inbox, delivery),
    realClock,
  )
  const reconcile = (): Promise<void> => {
    const { mcpSources, customMcpServers } = appSettings.getSnapshot()
    return runner.reconcile(mcpSources, customMcpServers)
  }
  void reconcile()
  const unsubscribe = appSettings.onChange(() => {
    void reconcile()
  })
  return {
    snapshot: () => ({ sources: runner.statuses() }),
    onStatus: (listener) => runner.onStatus(listener),
    sources: () => appSettings.getSnapshot().mcpSources,
    async stop() {
      unsubscribe()
      await runner.stop()
    },
  }
}
