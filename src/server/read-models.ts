import process from "node:process"
import type {
  AgentProvider,
  ChatActivity,
  ChatBackgroundTask,
  ChatRuntime,
  ChatSnapshot,
  ChatStateTimings,
  ClaudeSessionLifecycleStatus,
  CustomModelEntry,
  KannaStatus,
  LocalProjectsSnapshot,
  LoopRateLimitInfo,
  SidebarChatRow,
  SidebarData,
  SidebarProjectGroup,
  StackSummary,
} from "../shared/types"
import { mergeCustomModels } from "../shared/types"
import type { LoopTrackingSnapshot } from "../shared/loop-progress"
import { buildLoopProgress } from "../shared/loop-progress"
import type { ChatRecord, ChatTimingState, StoreState } from "./events"
import { resolveLocalPath } from "./paths"
import { resolveSpawnPaths } from "./claude-session-config"
import { SERVER_PROVIDERS } from "./provider-catalog"
import { deriveChatSchedules, deriveLoopState } from "./auto-continue/read-model"
import { deriveCronJobs } from "./cron/read-model"
import type { CronJobSnapshot } from "../shared/cron/types"
import type { WorkflowRegistry } from "./workflow-registry"

const EMPTY_CRON_JOBS: readonly CronJobSnapshot[] = []
import { deriveChatTunnels } from "./cloudflare-tunnel/read-model"
import type { CloudflareTunnelEvent } from "./cloudflare-tunnel/events"

export const ACTIVE_SESSION_IDLE_GAP_MS = 30 * 60 * 1_000
const SIDEBAR_RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000
const SIDEBAR_FALLBACK_PREVIEW_LIMIT = 5

export interface ComputeChatActivityDeps {
  state: StoreState
  activeStatuses: Map<string, KannaStatus>
  workflowRegistry?: Pick<WorkflowRegistry, "snapshot">
  backgroundTasksByChatId?: Map<string, ChatBackgroundTask[]>
  getLoopTracking?: (chatId: string) => LoopTrackingSnapshot | null
  nowMs: number
}

export function computeChatActivity(chatId: string, deps: ComputeChatActivityDeps): ChatActivity {
  const { state, activeStatuses, workflowRegistry, backgroundTasksByChatId, getLoopTracking, nowMs } = deps

  const runMap = state.subagentRunsByChatId.get(chatId)
  const agents = runMap ? [...runMap.values()].filter((r) => r.status === "running").length : 0

  const workflowSummaries = workflowRegistry?.snapshot(chatId) ?? []
  const activeWorkflow = workflowSummaries.find((s) => s.status === "running") ?? null
  const workflow = activeWorkflow
    ? { name: activeWorkflow.workflowName ?? null, agentCount: activeWorkflow.agentCount ?? 0 }
    : null

  const autoContinueEvents = state.autoContinueEventsByChatId.get(chatId) ?? []
  const loopState = deriveLoopState(autoContinueEvents, chatId)
  let loop: ChatActivity["loop"] = null
  if (loopState !== null) {
    const tracking = getLoopTracking?.(chatId) ?? null
    const done = tracking?.doneEntries.length ?? 0
    const liveCount = runMap ? [...runMap.values()].filter((r) => r.status === "running").length : 0
    const hasNext = tracking !== null && tracking.nextChunkSection.trim().length > 0
    const total = done + liveCount + (hasNext ? 1 : 0)
    loop = { done, total }
  }

  const backgroundTasks = backgroundTasksByChatId?.get(chatId)?.length ?? 0

  const cronJobs = deriveCronJobs(autoContinueEvents, chatId, nowMs)
  const activeCron = cronJobs.find((j) => !j.paused) ?? cronJobs[0] ?? null
  const cron = activeCron ? { nextFireAt: activeCron.nextFireAt, paused: activeCron.paused } : null

  const awaitingAnswer = activeStatuses.get(chatId) === "waiting_for_user"

  return { agents, workflow, loop, backgroundTasks, cron, awaitingAnswer }
}

export function deriveStatus(chat: ChatRecord, activeStatus?: KannaStatus): KannaStatus {
  if (activeStatus) return activeStatus
  if (chat.lastTurnOutcome === "failed") return "failed"
  return "idle"
}

function getSidebarChatSortTimestamp(chat: ChatRecord) {
  return chat.lastMessageAt ?? chat.createdAt
}

export function canForkChat(
  chat: ChatRecord,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
) {
  if (!chat.provider) return false
  const hasCurrentProviderToken =
    Boolean(chat.sessionTokensByProvider[chat.provider])
    || (chat.pendingForkSessionToken?.provider === chat.provider
      && Boolean(chat.pendingForkSessionToken.token))
  if (!hasCurrentProviderToken) return false
  if (activeStatuses.has(chat.id)) return false
  if (drainingChatIds.has(chat.id)) return false
  return true
}

function getSidebarChatTimestamp(chat: Pick<SidebarChatRow, "lastMessageAt" | "_creationTime">) {
  return chat.lastMessageAt ?? chat._creationTime
}

function isSidebarChatRecent(chat: Pick<SidebarChatRow, "lastMessageAt" | "_creationTime">, nowMs: number) {
  return Math.max(0, nowMs - getSidebarChatTimestamp(chat)) < SIDEBAR_RECENT_WINDOW_MS
}

function getSidebarChatBuckets(chats: SidebarChatRow[], nowMs: number) {
  const recentChats = chats.filter((chat) => isSidebarChatRecent(chat, nowMs))
  const previewChats = recentChats.length > 0
    ? recentChats
    : chats.slice(0, Math.min(SIDEBAR_FALLBACK_PREVIEW_LIMIT, chats.length))
  const previewChatIds = new Set(previewChats.map((chat) => chat.chatId))

  return {
    previewChats,
    olderChats: chats.filter((chat) => !previewChatIds.has(chat.chatId)),
  }
}

function computeSourceProvider(
  chats: SidebarChatRow[],
  localPath: string,
  discoveredProvidersByPath: Map<string, AgentProvider[]>,
): AgentProvider | null {
  const providerFromHistory = chats.find((c) => c.provider != null)?.provider ?? null
  if (providerFromHistory != null) return providerFromHistory

  const discoveredProviders = discoveredProvidersByPath.get(localPath)
  if (discoveredProviders?.length === 1) return discoveredProviders[0] ?? null
  return null
}

export function deriveSidebarData(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>,
  options?: {
    nowMs?: number
    sidebarProjectOrder?: string[]
    drainingChatIds?: Set<string>
    claudeSessionStates?: Map<string, ClaudeSessionLifecycleStatus>
    discoveredProvidersByPath?: Map<string, AgentProvider[]>
    workflowRegistry?: Pick<WorkflowRegistry, "snapshot">
    backgroundTasksByChatId?: Map<string, ChatBackgroundTask[]>
    getLoopTracking?: (chatId: string) => LoopTrackingSnapshot | null
  }
): SidebarData {
  const nowMs = options?.nowMs ?? Date.now()
  const drainingChatIds = options?.drainingChatIds ?? new Set<string>()
  const claudeSessionStates = options?.claudeSessionStates ?? new Map<string, ClaudeSessionLifecycleStatus>()
  const discoveredProvidersByPath = options?.discoveredProvidersByPath ?? new Map<string, AgentProvider[]>()
  const activityDeps: ComputeChatActivityDeps = {
    state,
    activeStatuses,
    workflowRegistry: options?.workflowRegistry,
    backgroundTasksByChatId: options?.backgroundTasksByChatId,
    getLoopTracking: options?.getLoopTracking,
    nowMs,
  }
  const chatsByProjectId = new Map<string, ChatRecord[]>()
  const archivedChatsByProjectId = new Map<string, ChatRecord[]>()
  for (const chat of state.chatsById.values()) {
    if (chat.deletedAt) continue
    const targetMap = chat.archivedAt ? archivedChatsByProjectId : chatsByProjectId
    const projectChats = targetMap.get(chat.projectId)
    if (projectChats) {
      projectChats.push(chat)
      continue
    }
    targetMap.set(chat.projectId, [chat])
  }

  const allProjects = [...state.projectsById.values()]
    .filter((project) => !project.deletedAt)
  const unorderedProjects = allProjects
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const projectById = new Map(unorderedProjects.map((project) => [project.id, project]))
  const orderedProjects = (options?.sidebarProjectOrder ?? [])
    .map((projectId) => projectById.get(projectId))
    .filter((project): project is NonNullable<typeof project> => Boolean(project))
  const orderedProjectIds = new Set(orderedProjects.map((project) => project.id))
  const projects = [
    ...orderedProjects,
    ...unorderedProjects.filter((project) => !orderedProjectIds.has(project.id)),
  ]

  function toSidebarChatRows(project: NonNullable<typeof projects[number]>, projectChats: ChatRecord[]) {
    return projectChats
      .sort((a, b) => getSidebarChatSortTimestamp(b) - getSidebarChatSortTimestamp(a))
      .map((chat) => ({
        _id: chat.id,
        _creationTime: chat.createdAt,
        chatId: chat.id,
        title: chat.title,
        status: deriveStatus(chat, activeStatuses.get(chat.id)),
        unread: chat.unread,
        localPath: project.localPath,
        provider: chat.provider,
        lastMessageAt: chat.lastMessageAt,
        activity: computeChatActivity(chat.id, activityDeps),
        canFork: canForkChat(chat, activeStatuses, drainingChatIds) || undefined,
        stateEnteredAt: state.chatTimingsByChatId.get(chat.id)?.stateEnteredAt,
        stackId: chat.stackId,
        sessionState: claudeSessionStates.get(chat.id) ?? "cold",
        hasPolicyOverride: chat.policyOverride != null,
      }))
  }

  const allGroups: SidebarProjectGroup[] = projects.map((project) => {
    const chats = toSidebarChatRows(project, chatsByProjectId.get(project.id) ?? [])
    const archivedChats = toSidebarChatRows(project, archivedChatsByProjectId.get(project.id) ?? [])
    const { previewChats, olderChats } = getSidebarChatBuckets(chats, nowMs)

    const sourceProvider = computeSourceProvider(chats, project.localPath, discoveredProvidersByPath)

    return {
      groupKey: project.id,
      localPath: project.localPath,
      chats,
      previewChats,
      olderChats,
      ...(archivedChats.length ? { archivedChats } : {}),
      defaultCollapsed: chats.every((chat) => !isSidebarChatRecent(chat, nowMs)),
      ...(project.starredAt != null ? { starredAt: project.starredAt } : {}),
      ...(sourceProvider != null ? { sourceProvider } : {}),
    }
  })

  const starredProjectGroups = allGroups
    .filter((g) => g.starredAt != null)
    .sort((a, b) => {
      const diff = (b.starredAt ?? 0) - (a.starredAt ?? 0)
      if (diff !== 0) return diff
      return a.groupKey.localeCompare(b.groupKey)
    })
  const projectGroups = allGroups.filter((g) => g.starredAt == null)

  return { starredProjectGroups, projectGroups, stacks: stackSummaries(state) }
}

export function deriveLocalProjectsSnapshot(
  state: StoreState,
  discoveredProjects: Array<{ localPath: string; title: string; modifiedAt: number }>,
  machineName: string,
  homeDir: string
): LocalProjectsSnapshot {
  const projects = new Map<string, LocalProjectsSnapshot["projects"][number]>()

  for (const project of discoveredProjects) {
    const normalizedPath = resolveLocalPath(project.localPath)
    projects.set(normalizedPath, {
      localPath: normalizedPath,
      title: project.title,
      source: "discovered",
      lastOpenedAt: project.modifiedAt,
      chatCount: 0,
    })
  }

  for (const project of [...state.projectsById.values()].filter((entry) => !entry.deletedAt)) {
    const chats = [...state.chatsById.values()].filter((chat) => chat.projectId === project.id && !chat.deletedAt && !chat.archivedAt)
    const lastOpenedAt = chats.reduce(
      (latest, chat) => Math.max(latest, getSidebarChatSortTimestamp(chat)),
      project.updatedAt
    )

    projects.set(project.localPath, {
      localPath: project.localPath,
      title: project.title,
      source: "saved",
      lastOpenedAt,
      chatCount: chats.length,
    })
  }

  return {
    machine: {
      id: "local",
      displayName: machineName,
      platform: process.platform,
      homeDir,
    },
    projects: [...projects.values()].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
  }
}

export function deriveTimings(
  chat: Pick<ChatRecord, "createdAt">,
  accumulator: ChatTimingState | undefined,
  activeStatus: KannaStatus | undefined,
  waitStartedAt: number | undefined,
  nowMs: number,
): ChatStateTimings {
  const cumulativeMs = {
    idle: 0,
    starting: 0,
    running: 0,
    waiting_for_user: 0,
    failed: 0,
  }

  if (!accumulator) {
    // Legacy chat with no events folded yet
    const idleSegment = Math.max(0, nowMs - chat.createdAt)
    cumulativeMs.idle = idleSegment
    return {
      activeSessionStartedAt: chat.createdAt,
      chatCreatedAt: chat.createdAt,
      stateEnteredAt: chat.createdAt,
      lastTurnDurationMs: null,
      derivedAtMs: nowMs,
      cumulativeMs,
    }
  }

  cumulativeMs.idle = accumulator.cumulativeMs.idle
  cumulativeMs.starting = accumulator.cumulativeMs.starting
  cumulativeMs.running = accumulator.cumulativeMs.running
  cumulativeMs.failed = accumulator.cumulativeMs.failed

  // Open segment from accumulator's stateEnteredAt → nowMs
  const openSegmentMs = Math.max(0, nowMs - accumulator.stateEnteredAt)

  let stateEnteredAt = accumulator.stateEnteredAt

  if (activeStatus === "waiting_for_user" && waitStartedAt != null) {
    // Add the running portion before wait started
    const preWaitMs = Math.max(0, waitStartedAt - accumulator.stateEnteredAt)
    cumulativeMs[accumulator.status] += preWaitMs
    cumulativeMs.waiting_for_user += Math.max(0, nowMs - waitStartedAt)
    stateEnteredAt = waitStartedAt
  } else {
    cumulativeMs[accumulator.status] += openSegmentMs
  }

  return {
    activeSessionStartedAt: accumulator.activeSessionStartedAt,
    chatCreatedAt: chat.createdAt,
    stateEnteredAt,
    lastTurnDurationMs: accumulator.lastTurnDurationMs,
    derivedAtMs: nowMs,
    cumulativeMs,
  }
}

const EMPTY_BACKGROUND_TASKS: ChatBackgroundTask[] = []

export function deriveChatSnapshot(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
  chatId: string,
  getMessages: (chatId: string) => Pick<ChatSnapshot, "messages" | "history">,
  getTunnelEvents: (chatId: string) => readonly CloudflareTunnelEvent[],
  waitStartedAtByChatId: Map<string, number> = new Map(),
  nowMs: number = Date.now(),
  claudeSessionStates: Map<string, ClaudeSessionLifecycleStatus> = new Map(),
  customModels: readonly CustomModelEntry[] = [],
  backgroundTasksByChatId: Map<string, ChatBackgroundTask[]> = new Map(),
  getLoopTracking: (chatId: string) => LoopTrackingSnapshot | null = () => null,
): ChatSnapshot | null {
  const chat = state.chatsById.get(chatId)
  if (!chat || chat.deletedAt) return null
  const project = state.projectsById.get(chat.projectId)
  if (!project || project.deletedAt) return null

  const runtime: ChatRuntime = {
    chatId: chat.id,
    projectId: project.id,
    // The chat's OWN working directory — its worktree when it has one. Reporting
    // the project's checkout told the reader they were on `main` in the main
    // tree while the agent edited a card branch somewhere else, and pointed
    // "Open in Finder" at the wrong directory.
    localPath: resolveSpawnPaths(chat, project.localPath).cwd,
    title: chat.title,
    status: deriveStatus(chat, activeStatuses.get(chat.id)),
    isDraining: drainingChatIds.has(chat.id),
    provider: chat.provider,
    planMode: chat.planMode,
    sessionTokensByProvider: { ...chat.sessionTokensByProvider },
    timings: deriveTimings(
      chat,
      state.chatTimingsByChatId.get(chat.id),
      activeStatuses.get(chat.id),
      waitStartedAtByChatId.get(chat.id),
      nowMs,
    ),
    policyOverride: chat.policyOverride ?? null,
    sessionState: claudeSessionStates.get(chat.id) ?? "cold",
    backgroundTasks: backgroundTasksByChatId.get(chat.id) ?? EMPTY_BACKGROUND_TASKS,
  }

  const transcript = getMessages(chat.id)
  const autoContinueEvents = state.autoContinueEventsByChatId.get(chat.id) ?? []
  const { schedules, liveScheduleId } = deriveChatSchedules(autoContinueEvents, chat.id)
  const { tunnels, liveTunnelId } = deriveChatTunnels(getTunnelEvents(chat.id), chat.id)

  const resolvedBindings = chat.stackBindings && chat.stackBindings.length > 0
    ? chat.stackBindings.map((binding) => {
        const bindingProject = state.projectsById.get(binding.projectId)
        const projectStatus: "active" | "missing" = bindingProject && !bindingProject.deletedAt ? "active" : "missing"
        return {
          projectId: binding.projectId,
          projectTitle: bindingProject?.title ?? "(missing)",
          worktreePath: binding.worktreePath,
          role: binding.role,
          projectStatus,
        }
      })
    : undefined

  const subagentRunsMap = state.subagentRunsByChatId.get(chat.id)
  // Clone each run + its entries array so the snapshot is immutable. The
  // reducer mutates `run.entries.push(...)` in place; without this clone every
  // snapshot would share the same growing array, defeating client-side
  // structural-compare dedup (sameChatSnapshotCore → sameSubagentRuns).
  const subagentRuns: ChatSnapshot["subagentRuns"] = subagentRunsMap
    ? Object.fromEntries(
        Array.from(subagentRunsMap.entries(), ([id, run]) => [id, { ...run, entries: [...run.entries] }]),
      )
    : {}

  const loopState = deriveLoopState(autoContinueEvents, chat.id)
  const liveSchedule = liveScheduleId ? schedules[liveScheduleId] : undefined
  const rateLimit: LoopRateLimitInfo | null =
    loopState
    && liveSchedule
    && (liveSchedule.state === "proposed" || liveSchedule.state === "scheduled")
    && liveSchedule.resetAt != null
      ? {
          scheduleId: liveSchedule.scheduleId,
          resetAt: liveSchedule.resetAt,
          tz: liveSchedule.tz ?? "system",
          scheduled: liveSchedule.state === "scheduled",
        }
      : null
  const loopProgress = buildLoopProgress({
    chatId: chat.id,
    armed: loopState !== null,
    loopArmedAt: loopState?.armedAt ?? null,
    runs: subagentRunsMap ? [...subagentRunsMap.values()] : [],
    rateLimit,
    tracking: getLoopTracking(chat.id),
  })
  const derivedCronJobs = deriveCronJobs(autoContinueEvents, chat.id, nowMs)
  const cronJobs = derivedCronJobs.length > 0 ? derivedCronJobs : EMPTY_CRON_JOBS

  return {
    runtime,
    queuedMessages: (state.queuedMessagesByChatId.get(chat.id) ?? []).map((entry) => ({
      ...entry,
      attachments: [...entry.attachments],
    })),
    messages: transcript.messages,
    history: transcript.history,
    availableProviders: mergeCustomModels([...SERVER_PROVIDERS], customModels),
    schedules,
    liveScheduleId,
    tunnels,
    liveTunnelId,
    subagentRuns,
    loopProgress,
    cronJobs,
    ...(resolvedBindings !== undefined ? { resolvedBindings } : {}),
  }
}

export function stackSummaries(state: StoreState): StackSummary[] {
  return [...state.stacksById.values()]
    .filter((s) => !s.deletedAt)
    .map((s) => ({
      id: s.id,
      title: s.title,
      projectIds: [...s.projectIds],
      memberCount: s.projectIds.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }))
}
