import type { ComponentProps } from "react"
import type { JSONUIProvider, StateStore } from "@json-render/react"
import type { StoreApi } from "zustand"
import { z } from "zod"
import {
  GENUI_ACTIONS,
  buildExplainVarianceIntent,
  buildFreeformIntent,
  formatIntentMessage,
  isGenUIActionName,
  jsonObjectSchema,
  periodSpecSchema,
  runDatasetQuery,
  type AgentIntent,
  type DatasetDecl,
  type DatasetQuery,
  type GenUIActionName,
  type GenUISpec,
  type QueryResult,
} from "../../../shared/genui"
import type { JsonObject } from "../../../shared/json"
import type { GenUIHost } from "./host"
import type { GenUIViewState } from "./view-store"

export type GenUIActionHandlers = NonNullable<ComponentProps<typeof JSONUIProvider>["handlers"]>

export const DRILL_STATE_ROOT = "/_drill"

export function drillStatePath(datasetId: string): string {
  return `${DRILL_STATE_ROOT}/${datasetId}`
}

export const drillStateSchema = z.object({
  dimension: z.string(),
  value: z.string(),
  into: z.string(),
  metric: z.string(),
  period: periodSpecSchema.optional(),
})

export type DrillState = z.output<typeof drillStateSchema>

export interface GenUIActionRuntime {
  host: () => GenUIHost
  view: StoreApi<GenUIViewState>
  spec: GenUISpec
  state: StateStore
}

export function resolveWorkspacePath(root: string | null, target: string): string | null {
  if (!root) return null
  const base = root.endsWith("/") ? root.slice(0, -1) : root
  if (target.startsWith("/")) return target === base || target.startsWith(`${base}/`) ? target : null
  const segments = target.replaceAll("\\", "/").split("/").filter((segment) => segment !== "" && segment !== ".")
  if (segments.some((segment) => segment === "..")) return null
  return `${base}/${segments.join("/")}`
}

function notice(runtime: GenUIActionRuntime, text: string): void {
  runtime.view.getState().showNotice(text)
}

function propose(runtime: GenUIActionRuntime, intent: AgentIntent): void {
  if (!runtime.host().sendToAgent) {
    notice(runtime, "Asking the agent is not available in this view")
    return
  }
  runtime.view.getState().proposeAgentMessage({ headline: intent.headline, message: formatIntentMessage(intent) })
}

async function explainQuery(host: GenUIHost, decl: DatasetDecl, query: DatasetQuery): Promise<QueryResult | null> {
  if (decl.source === "inline") {
    const outcome = runDatasetQuery(decl, decl.rows, query)
    return outcome.ok ? outcome.result : null
  }
  if (!host.queryDataset) return null
  const outcome = await host.queryDataset(decl, query, false)
  return outcome.status === "ok" ? outcome.result : null
}

async function dispatch(runtime: GenUIActionRuntime, name: GenUIActionName, raw: JsonObject): Promise<void> {
  const host = runtime.host()
  const view = { title: runtime.spec.title }
  switch (name) {
    case "setState":
    case "pushState":
    case "removeState":
      return
    case "file.open": {
      const params = GENUI_ACTIONS["file.open"].params.safeParse(raw)
      if (!params.success) return notice(runtime, "That file link is malformed")
      const absolute = resolveWorkspacePath(host.workspaceRoot, params.data.path)
      if (!absolute) return notice(runtime, `"${params.data.path}" is outside this chat's workspace`)
      runtime.view.getState().openPreview(absolute)
      return
    }
    case "link.open": {
      const params = GENUI_ACTIONS["link.open"].params.safeParse(raw)
      if (!params.success) return notice(runtime, "Only https links can be opened")
      host.openLink(params.data.url)
      return
    }
    case "dataset.refresh": {
      const params = GENUI_ACTIONS["dataset.refresh"].params.safeParse(raw)
      if (params.success) runtime.view.getState().refreshDataset(params.data.dataset)
      return
    }
    case "financial.drilldown": {
      const params = GENUI_ACTIONS["financial.drilldown"].params.safeParse(raw)
      if (!params.success) return notice(runtime, "That drilldown is malformed")
      const { dataset, ...drill } = params.data
      runtime.state.set(drillStatePath(dataset), drill)
      return
    }
    case "agent.ask": {
      const params = GENUI_ACTIONS["agent.ask"].params.safeParse(raw)
      if (!params.success) return notice(runtime, "That question is malformed")
      return propose(runtime, buildFreeformIntent("agent.ask", params.data.prompt, params.data.context, view))
    }
    case "agent.investigate":
    case "agent.fix": {
      const params = GENUI_ACTIONS[name].params.safeParse(raw)
      if (!params.success) return notice(runtime, "That request is malformed")
      return propose(runtime, buildFreeformIntent(name, params.data.subject, params.data.context, view))
    }
    case "financial.explainVariance": {
      const params = GENUI_ACTIONS["financial.explainVariance"].params.safeParse(raw)
      if (!params.success) return notice(runtime, "That explanation request is malformed")
      const decl = runtime.spec.datasets?.[params.data.dataset]
      if (!decl) return notice(runtime, `Unknown dataset "${params.data.dataset}"`)
      const compareWith = params.data.compareWith ?? "previous-period"
      const result = await explainQuery(host, decl, {
        metrics: [params.data.metric],
        ...(params.data.period ? { period: params.data.period } : {}),
        ...(params.data.filters ? { filters: params.data.filters } : {}),
        compare: compareWith,
      })
      return propose(runtime, buildExplainVarianceIntent({
        datasetId: params.data.dataset,
        decl,
        metric: params.data.metric,
        ...(params.data.period ? { period: params.data.period } : {}),
        compareWith,
        ...(params.data.filters ? { filters: params.data.filters } : {}),
        ...(params.data.question ? { question: params.data.question } : {}),
        result,
      }, view))
    }
  }
}

export function createGenUIActionHandlers(runtime: GenUIActionRuntime): GenUIActionHandlers {
  const handlers: GenUIActionHandlers = {}
  for (const name of Object.keys(GENUI_ACTIONS)) {
    if (!isGenUIActionName(name) || GENUI_ACTIONS[name].class === "local") continue
    handlers[name] = async (params) => {
      if (runtime.host().readonly) return
      const parsed = jsonObjectSchema.safeParse(params)
      if (!parsed.success) return notice(runtime, "That action's parameters are not plain data")
      await dispatch(runtime, name, parsed.data)
    }
  }
  return handlers
}

export async function dispatchGenUIAction(runtime: GenUIActionRuntime, name: GenUIActionName, params: JsonObject): Promise<void> {
  if (runtime.host().readonly && GENUI_ACTIONS[name].class !== "local") return
  await dispatch(runtime, name, params)
}
