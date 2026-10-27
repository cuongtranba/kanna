import type { AgentProvider } from "../../shared/core-types"
import type { ProviderCatalogEntry } from "../../shared/provider-model-types"
import { isAgentProvider, type SidebarData } from "../../shared/types"
import type { WebhookConfig } from "../../shared/webhooks/types"
import type { SearchableOption } from "../components/ui/searchable-select"
import { fileNameOfPath } from "./pathUtils"

export interface WebhookTargetOption {
  value: string
  label: string
  hint?: string
}

export interface WebhookTargets {
  chats: WebhookTargetOption[]
  projects: WebhookTargetOption[]
}

export function listWebhookTargets(sidebar: SidebarData): WebhookTargets {
  const chats: WebhookTargetOption[] = []
  const projects: WebhookTargetOption[] = []
  for (const group of [...sidebar.starredProjectGroups, ...sidebar.projectGroups]) {
    const projectName = fileNameOfPath(group.localPath)
    projects.push({ value: group.groupKey, label: projectName, hint: group.localPath })
    for (const chat of group.chats) {
      chats.push({ value: chat.chatId, label: `${projectName} / ${chat.title || "Untitled chat"}`, hint: group.localPath })
    }
  }
  return { chats, projects }
}

export function describeWebhookTarget(hook: WebhookConfig, targets: WebhookTargets): string {
  if (hook.mode === "spawn") {
    const project = targets.projects.find((option) => option.value === hook.projectId)
    return project ? `New chat in ${project.label}` : "Project no longer available"
  }
  const chat = targets.chats.find((option) => option.value === hook.chatId)
  return chat ? chat.label : "Chat no longer available"
}

export interface WebhookModelChoice {
  provider: AgentProvider
  model: string
}

export function encodeWebhookModel(provider: AgentProvider, model: string): string {
  return `${provider}:${model}`
}

export function decodeWebhookModel(value: string): WebhookModelChoice | null {
  const split = value.indexOf(":")
  if (split <= 0) return null
  const provider = value.slice(0, split)
  const model = value.slice(split + 1)
  if (!isAgentProvider(provider) || model.length === 0) return null
  return { provider, model }
}

export function listWebhookModelOptions(catalog: readonly ProviderCatalogEntry[]): SearchableOption[] {
  const options: SearchableOption[] = [
    {
      value: "",
      label: "Default model",
      hint: "The chat's own model, or the provider default for a new chat",
    },
  ]
  for (const entry of catalog) {
    for (const model of entry.models) {
      options.push({
        value: encodeWebhookModel(entry.id, model.id),
        label: model.label,
        hint: model.id,
        group: entry.label,
      })
    }
  }
  return options
}

export function describeWebhookModel(
  hook: Pick<WebhookConfig, "provider" | "model">,
  catalog: readonly ProviderCatalogEntry[],
): string | null {
  if (!hook.provider || !hook.model) return null
  const entry = catalog.find((candidate) => candidate.id === hook.provider)
  return entry?.models.find((option) => option.id === hook.model)?.label ?? hook.model
}
