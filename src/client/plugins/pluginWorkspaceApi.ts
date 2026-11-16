import type { StartChatOptions, Workspace, WorkspaceChat, WorkspaceCronJob, WorkspaceProject } from "@kanna/plugin"
import { useCallback, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { humanizeSchedule } from "../../shared/cron/humanize"
import type { CronJobsGlobalRow } from "../../shared/cron/types"
import { allProjectGroups } from "../../shared/sidebar-data"
import type { SidebarChatRow, SidebarData } from "../../shared/types"
import { makeChatNavigator } from "../app/chatNavigator"
import { adoptNewChat } from "../app/chatLifecycle"
import { useKannaSocketInstance } from "../app/KannaSocketProvider"
import type { KannaSocket } from "../app/socket"
import { surfaceCommandError } from "../lib/commandFeedback"
import { toSendOptions } from "../lib/composerSendOptions"
import { chatPath } from "../lib/paneTree"
import { NEW_CHAT_COMPOSER_ID, useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { useCronJobsStore } from "../stores/cronJobsStore"
import { useKannaStateStore } from "../stores/kannaStateStore"
import { useNewSessionStore } from "../stores/newSessionStore"
import { pendingActionKey, runPendingAction, usePendingScope } from "../stores/pendingActionsStore"

const START_CHAT_SCOPE = "plugin.startChat"
const PATH_SEPARATORS = /[\\/]+/

function projectNameFromPath(localPath: string): string {
  return localPath.split(PATH_SEPARATORS).filter((part) => part.length > 0).at(-1) ?? localPath
}

function toWorkspaceChat(row: SidebarChatRow): WorkspaceChat {
  return {
    chatId: row.chatId,
    title: row.title,
    status: row.status,
    unread: row.unread,
    lastMessageAt: row.lastMessageAt ?? null,
  }
}

function toWorkspaceCronJob({ chatId, job }: CronJobsGlobalRow): WorkspaceCronJob {
  return {
    jobId: job.jobId,
    chatId,
    instruction: job.instruction,
    mode: job.mode,
    schedule: job.scheduleText,
    scheduleHuman: humanizeSchedule(job.schedule, job.scheduleText),
    paused: job.paused,
    model: job.model ?? null,
    nextFireAt: job.nextFireAt,
    lastRun: job.lastRun ? { status: job.lastRun.status, firedAt: job.lastRun.firedAt } : null,
  }
}

function recency(chat: WorkspaceChat): number {
  return chat.lastMessageAt ?? 0
}

function buildWorkspaceProjects(data: SidebarData, cronRows: readonly CronJobsGlobalRow[]): WorkspaceProject[] {
  const chatsByPath = new Map<string, Map<string, WorkspaceChat>>()
  for (const group of allProjectGroups(data)) {
    const chats = chatsByPath.get(group.localPath) ?? new Map<string, WorkspaceChat>()
    for (const row of [...group.chats, ...group.previewChats, ...group.olderChats]) {
      if (!chats.has(row.chatId)) chats.set(row.chatId, toWorkspaceChat(row))
    }
    chatsByPath.set(group.localPath, chats)
  }
  return [...chatsByPath.entries()].map(([localPath, chats]) => ({
    localPath,
    name: projectNameFromPath(localPath),
    chats: [...chats.values()].sort((left, right) => recency(right) - recency(left)),
    cronJobs: cronRows.filter((row) => row.projectPath === localPath).map(toWorkspaceCronJob),
  }))
}

async function resolveProjectId(socket: KannaSocket, localPath: string): Promise<string> {
  const listed = allProjectGroups(useKannaStateStore.getState().sidebarData).find((group) => group.localPath === localPath)
  if (listed) return listed.groupKey
  const opened = await socket.command({ type: "project.open", localPath })
  return opened.projectId
}

async function startProjectChat(
  socket: KannaSocket,
  navigate: (path: string) => void,
  localPath: string,
  options: StartChatOptions | undefined,
): Promise<void> {
  const projectId = await resolveProjectId(socket, localPath)
  const sourceState = useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)
  const prompt = options?.prompt
  let chatId: string
  if (prompt) {
    const sent = await socket.command({ type: "chat.send", projectId, content: prompt, ...toSendOptions(sourceState, false) })
    chatId = sent.chatId
  } else {
    const created = await socket.command({ type: "chat.create", projectId })
    useNewSessionStore.getState().markSpawned(created.chatId)
    chatId = created.chatId
  }
  adoptNewChat(makeChatNavigator(navigate), { chatId, projectId, sourceState })
}

export function useKannaWorkspace(): Workspace {
  const socket = useKannaSocketInstance()
  const navigate = useNavigate()
  const sidebarData = useKannaStateStore((state) => state.sidebarData)
  const ready = useKannaStateStore((state) => state.sidebarReady)
  const cronRows = useCronJobsStore((state) => state.rows)
  const starting = usePendingScope(START_CHAT_SCOPE)

  const projects = useMemo(() => buildWorkspaceProjects(sidebarData, cronRows), [sidebarData, cronRows])
  const openChat = useCallback((chatId: string) => navigate(chatPath(chatId)), [navigate])
  const startChat = useCallback(
    (localPath: string, options?: StartChatOptions) => {
      runPendingAction(pendingActionKey(START_CHAT_SCOPE, localPath), async () => {
        await surfaceCommandError(() => startProjectChat(socket, navigate, localPath, options))
      })
    },
    [socket, navigate],
  )

  return useMemo(() => ({ projects, ready, starting, openChat, startChat }), [projects, ready, starting, openChat, startChat])
}
