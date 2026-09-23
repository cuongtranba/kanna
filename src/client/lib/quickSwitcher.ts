import type {
  KeybindingsSnapshot,
  LocalProjectSummary,
  SidebarChatRow,
  SidebarData,
  SidebarProjectGroup,
} from "../../shared/types"
import { actionMatchesEvent } from "./keybindings"
import { getPathBasename } from "./formatters"

export const TERMINAL_CONTAINER_SELECTOR = ".kanna-terminal"

export interface QuickSwitcherProject {
  projectId: string | null
  name: string
  localPath: string
  starred: boolean
  sessionCount: number
  lastActivityAt: number
}

export interface QuickSwitcherSession {
  chatId: string
  title: string
  status: SidebarChatRow["status"]
  unread: boolean
  lastMessageAt: number | undefined
}

const MATCH_PREFIX = 4000
const MATCH_WORD_START = 3000
const MATCH_SUBSTRING = 2000
const MATCH_SUBSEQUENCE = 1000

export function scoreMatch(haystack: string, needle: string): number | null {
  if (needle === "") return 0

  const text = haystack.toLowerCase()
  const query = needle.toLowerCase()

  if (text.startsWith(query)) return MATCH_PREFIX - text.length

  const index = text.indexOf(query)
  if (index >= 0) {
    const previous = text[index - 1]
    const atWordStart = previous === undefined || previous === "-" || previous === "_" || previous === "." || previous === "/" || previous === " "
    const base = atWordStart ? MATCH_WORD_START : MATCH_SUBSTRING
    return base - index - text.length
  }

  const span = subsequenceSpan(text, query)
  if (span === null) return null
  return MATCH_SUBSEQUENCE - span
}

function subsequenceSpan(text: string, query: string): number | null {
  let start = -1
  let cursor = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== query[cursor]) continue
    if (cursor === 0) start = index
    cursor += 1
    if (cursor === query.length) return index - start
  }
  return null
}

export function toQuickSwitcherProjects(
  data: SidebarData,
  localProjects: readonly LocalProjectSummary[] = [],
): QuickSwitcherProject[] {
  const groups = [...data.starredProjectGroups, ...data.projectGroups]
  const seenIds = new Set<string>()
  const seenPaths = new Set<string>()
  const projects: QuickSwitcherProject[] = []

  for (const group of groups) {
    if (seenIds.has(group.groupKey)) continue
    seenIds.add(group.groupKey)
    seenPaths.add(group.localPath)
    const sessions = selectableChats(group)
    projects.push({
      projectId: group.groupKey,
      name: getPathBasename(group.localPath),
      localPath: group.localPath,
      starred: group.starredAt !== undefined,
      sessionCount: sessions.length,
      lastActivityAt: mostRecentActivity(sessions),
    })
  }

  for (const project of localProjects) {
    if (seenPaths.has(project.localPath)) continue
    seenPaths.add(project.localPath)
    projects.push({
      projectId: null,
      name: getPathBasename(project.localPath),
      localPath: project.localPath,
      starred: false,
      sessionCount: 0,
      lastActivityAt: project.lastOpenedAt ?? 0,
    })
  }

  return projects
}

export function toQuickSwitcherSessions(data: SidebarData, projectId: string): QuickSwitcherSession[] {
  const groups = [...data.starredProjectGroups, ...data.projectGroups]
  const group = groups.find((candidate) => candidate.groupKey === projectId)
  if (!group) return []

  return selectableChats(group)
    .map((chat) => ({
      chatId: chat.chatId,
      title: chat.title,
      status: chat.status,
      unread: chat.unread,
      lastMessageAt: chat.lastMessageAt,
    }))
    .sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0))
}

function selectableChats(group: SidebarProjectGroup): SidebarChatRow[] {
  return group.chats.filter((chat) => chat.stackId === undefined)
}

function mostRecentActivity(chats: readonly SidebarChatRow[]): number {
  let latest = 0
  for (const chat of chats) {
    const at = chat.lastMessageAt ?? 0
    if (at > latest) latest = at
  }
  return latest
}

export function filterProjects(
  projects: readonly QuickSwitcherProject[],
  query: string,
): QuickSwitcherProject[] {
  const scored: Array<{ project: QuickSwitcherProject; score: number }> = []

  for (const project of projects) {
    const nameScore = scoreMatch(project.name, query)
    const pathScore = scoreMatch(project.localPath, query)
    const score = bestScore(nameScore, pathScore)
    if (score === null) continue
    scored.push({ project, score })
  }

  return scored
    .sort((left, right) => compareProjects(left, right))
    .map((entry) => entry.project)
}

function bestScore(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

function compareProjects(
  left: { project: QuickSwitcherProject; score: number },
  right: { project: QuickSwitcherProject; score: number },
): number {
  if (left.score !== right.score) return right.score - left.score
  if (left.project.starred !== right.project.starred) return left.project.starred ? -1 : 1
  if (left.project.lastActivityAt !== right.project.lastActivityAt) {
    return right.project.lastActivityAt - left.project.lastActivityAt
  }
  return left.project.name.localeCompare(right.project.name)
}

export function filterSessions(
  sessions: readonly QuickSwitcherSession[],
  query: string,
): QuickSwitcherSession[] {
  if (query === "") return [...sessions]

  const scored: Array<{ session: QuickSwitcherSession; score: number }> = []
  for (const session of sessions) {
    const score = scoreMatch(session.title, query)
    if (score === null) continue
    scored.push({ session, score })
  }

  return scored
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return (right.session.lastMessageAt ?? 0) - (left.session.lastMessageAt ?? 0)
    })
    .map((entry) => entry.session)
}

export function isTerminalEventTarget(target: EventTarget | null): boolean {
  if (target === null) return false
  if (!(target instanceof Element)) return false
  return target.closest(TERMINAL_CONTAINER_SELECTOR) !== null
}

export function shouldToggleQuickSwitcher(
  keybindings: KeybindingsSnapshot | null,
  event: KeyboardEvent,
): boolean {
  if (isTerminalEventTarget(event.target)) return false
  return actionMatchesEvent(keybindings, "openProjectSwitcher", event)
}

export function shortenHomePath(localPath: string, homeDir: string): string {
  if (homeDir === "" || !localPath.startsWith(homeDir)) return localPath
  const remainder = localPath.slice(homeDir.length)
  if (remainder === "") return "~"
  if (!remainder.startsWith("/")) return localPath
  return `~${remainder}`
}

export function isMacUserAgent(userAgent: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(userAgent)
}

export function clampHighlight(index: number, length: number): number {
  if (length <= 0) return 0
  if (index < 0) return length - 1
  if (index >= length) return 0
  return index
}
