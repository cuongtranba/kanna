import type { SidebarChatRow, SidebarData, SidebarProjectGroup } from "./types"

export type SidebarGroupLists = Pick<SidebarData, "starredProjectGroups" | "projectGroups">

export function allProjectGroups(data: SidebarGroupLists): SidebarProjectGroup[] {
  return [...data.starredProjectGroups, ...data.projectGroups]
}

export function allChatRows(data: SidebarGroupLists): SidebarChatRow[] {
  return allProjectGroups(data).flatMap((group) => [...group.chats, ...group.previewChats, ...group.olderChats])
}
