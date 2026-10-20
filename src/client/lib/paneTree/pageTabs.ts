import { matchPath } from "react-router-dom"
import {
  isPane,
  type PageKind,
  type PageTabTarget,
  type PaneLayout,
  type PaneLeaf,
  type PaneNode,
  type PaneTab,
} from "./types"

export interface PageRoute {
  page: PageKind
  params: Record<string, string>
}

const PAGE_ROUTE_PATTERNS: ReadonlyArray<{ page: PageKind; pattern: string }> = [
  { page: "projects", pattern: "/" },
  { page: "settings", pattern: "/settings/:sectionId" },
  { page: "settings", pattern: "/settings" },
  { page: "cron", pattern: "/cron" },
  { page: "webhooks", pattern: "/webhooks" },
  { page: "inbox", pattern: "/inbox/:threadId" },
  { page: "inbox", pattern: "/inbox" },
  { page: "workflows", pattern: "/workflows/:chatId" },
  { page: "boards", pattern: "/boards/stack/:stackId" },
  { page: "boards", pattern: "/boards/:projectId" },
]

export function resolvePageRoute(path: string): PageRoute | null {
  for (const { page, pattern } of PAGE_ROUTE_PATTERNS) {
    const match = matchPath({ path: pattern, end: true }, path)
    if (!match) continue
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(match.params)) {
      if (value !== undefined) params[key] = value
    }
    return { page, params }
  }
  return null
}

export function pageTargetForPath(path: string): PageTabTarget | null {
  const route = resolvePageRoute(path)
  return route ? { kind: "page", page: route.page, path } : null
}

function collectLeaves(node: PaneNode): PaneLeaf[] {
  return isPane(node) ? [node] : node.children.flatMap(collectLeaves)
}

function pathOfTab(tab: PaneTab): string | null {
  if (tab.target.kind === "chat") return `/chat/${tab.target.chatId}`
  if (tab.target.kind === "page") return tab.target.path
  return null
}

export function fallbackPathAfterClose(layout: PaneLayout): string {
  const leaves = collectLeaves(layout.root)
  const focusedLeaf = leaves.find((leaf) => leaf.id === layout.focusedPaneId)
  const focusedTab = focusedLeaf?.tabs.find((tab) => tab.tabId === focusedLeaf.focusedTabId)
  const focusedPath = focusedTab ? pathOfTab(focusedTab) : null
  if (focusedPath) return focusedPath

  const tabs = leaves.flatMap((leaf) => leaf.tabs)
  const chatTab = tabs.find((tab) => tab.target.kind === "chat")
  if (chatTab) return pathOfTab(chatTab) ?? "/"
  const pageTab = tabs.find((tab) => tab.target.kind === "page")
  return (pageTab ? pathOfTab(pageTab) : null) ?? "/"
}
