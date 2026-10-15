import type { SidebarData } from "../../shared/types"
import type { WebhookConfig } from "../../shared/webhooks/types"
import { getPathBasename } from "./formatters"

export interface WebhookTargetOption {
  value: string
  label: string
}

export interface WebhookTargets {
  chats: WebhookTargetOption[]
  projects: WebhookTargetOption[]
}

export function listWebhookTargets(sidebar: SidebarData): WebhookTargets {
  const chats: WebhookTargetOption[] = []
  const projects: WebhookTargetOption[] = []
  for (const group of [...sidebar.starredProjectGroups, ...sidebar.projectGroups]) {
    const projectName = getPathBasename(group.localPath)
    projects.push({ value: group.groupKey, label: projectName })
    for (const chat of group.chats) {
      chats.push({ value: chat.chatId, label: `${projectName} / ${chat.title || "Untitled chat"}` })
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
