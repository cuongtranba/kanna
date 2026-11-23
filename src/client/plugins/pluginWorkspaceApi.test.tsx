import { afterEach, describe, expect, test } from "vite-plus/test"
import { act, useEffect } from "react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { EMPTY_CHAT_ACTIVITY, type SidebarChatRow, type SidebarProjectGroup } from "../../shared/types"
import type { CronJobsGlobalRow } from "../../shared/cron/types"
import { KannaSocketProvider } from "../app/KannaSocketProvider"
import { KannaSocket } from "../app/socket"
import { makeFakeDomPort, makeFakeTimerPort } from "../lib/testing/fakePorts"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { waitFor } from "../lib/testing/waitFor"
import { useCronJobsStore } from "../stores/cronJobsStore"
import { EMPTY_SIDEBAR_DATA, useKannaStateStore } from "../stores/kannaStateStore"
import type { WebSocketLike, WebSocketPort, WsEventPayload } from "../ports/webSocketPort"
import { createPluginHostRegistry } from "./hostModuleRegistry"
import { useKannaWorkspace } from "./pluginWorkspaceApi"

type Handler = (event?: WsEventPayload) => void

class FakeWebSocket implements WebSocketLike {
  readonly sent: Array<{ id: string; command: { type: string } & Record<string, string | undefined> }> = []
  private readonly listeners = new Map<string, Handler[]>()
  readyState = 0

  addEventListener(type: string, listener: Handler) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(message: string) {
    const envelope = JSON.parse(message)
    if (envelope.type === "command") this.sent.push({ id: envelope.id, command: envelope.command })
  }

  close() {}

  open() {
    this.readyState = 1
    for (const listener of this.listeners.get("open") ?? []) listener()
  }

  ack(id: string, result: Record<string, string>) {
    const data = JSON.stringify({ v: 1, type: "ack", id, result })
    for (const listener of this.listeners.get("message") ?? []) listener(new MessageEvent("message", { data }))
  }
}

function connectedSocket() {
  const sockets: FakeWebSocket[] = []
  const webSocket: WebSocketPort = {
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
    create: () => {
      const ws = new FakeWebSocket()
      sockets.push(ws)
      return ws
    },
  }
  const socket = new KannaSocket("ws://localhost/ws", {
    dom: makeFakeDomPort(),
    timer: makeFakeTimerPort(),
    webSocket,
  })
  socket.start()
  sockets[0].open()
  return { socket, ws: sockets[0] }
}

function chatRow(chatId: string, localPath: string, lastMessageAt?: number): SidebarChatRow {
  return {
    _id: chatId,
    _creationTime: 0,
    chatId,
    title: `title-${chatId}`,
    status: "idle",
    unread: false,
    localPath,
    provider: null,
    lastMessageAt,
    activity: EMPTY_CHAT_ACTIVITY,
  }
}

function group(projectId: string, localPath: string, chats: SidebarChatRow[], extra: Partial<SidebarProjectGroup> = {}): SidebarProjectGroup {
  return { groupKey: projectId, localPath, chats, previewChats: [], olderChats: [], defaultCollapsed: false, ...extra }
}

function cronRow(projectPath: string, chatId: string, jobId: string): CronJobsGlobalRow {
  return {
    projectId: `id-of-${projectPath}`,
    projectPath,
    chatId,
    chatTitle: "owner",
    job: {
      jobId,
      instruction: "check ci",
      mode: "spawn",
      scheduleText: "every 5m",
      schedule: { type: "interval", ms: 300_000 },
      paused: false,
      armedAt: 1_000,
      model: "claude-sonnet-4-5",
      nextFireAt: 301_000,
      lastRun: { runId: "r1", firedAt: 1_000, status: "completed", spawnedChatId: "spawned" },
      recentRuns: [],
    },
  }
}

type Workspace = ReturnType<typeof useKannaWorkspace>

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
  useKannaStateStore.setState({ sidebarData: EMPTY_SIDEBAR_DATA, sidebarReady: false })
  useCronJobsStore.setState({ rows: [] })
})

async function mountSurface(socket: KannaSocket) {
  const captured: { workspace: Workspace | null; path: string } = { workspace: null, path: "/" }
  function Surface() {
    const workspace = useKannaWorkspace()
    const { pathname } = useLocation()
    useEffect(() => {
      captured.workspace = workspace
      captured.path = pathname
    })
    return null
  }
  const rendered = await renderForLoopCheck(
    <MemoryRouter>
      <KannaSocketProvider socket={socket}>
        <Surface />
      </KannaSocketProvider>
    </MemoryRouter>,
  )
  cleanups.push(rendered.cleanup)
  return captured
}

function seedSidebar() {
  useKannaStateStore.setState({
    sidebarReady: true,
    sidebarData: {
      ...EMPTY_SIDEBAR_DATA,
      starredProjectGroups: [group("p-a", "/work/a", [chatRow("c1", "/work/a", 10)], { starredAt: 1 })],
      projectGroups: [
        group("p-b", "D:\\work\\b", [chatRow("c2", "D:\\work\\b", 5)], {
          previewChats: [chatRow("c2", "D:\\work\\b", 5)],
          olderChats: [chatRow("c3", "D:\\work\\b", 20)],
        }),
      ],
    },
  })
}

describe("useKannaWorkspace", () => {
  test("plugins receive the hook through the @kanna/plugin host module", () => {
    expect(createPluginHostRegistry().require("@kanna/plugin")).toMatchObject({ useKannaWorkspace })
  })

  test("lists every sidebar project with its chats newest first, without duplicates", async () => {
    seedSidebar()
    const { socket } = connectedSocket()
    const captured = await mountSurface(socket)

    expect(captured.workspace?.ready).toBe(true)
    expect(captured.workspace?.projects.map((project) => project.name)).toEqual(["a", "b"])
    expect(captured.workspace?.projects[1].chats.map((chat) => chat.chatId)).toEqual(["c3", "c2"])
    expect(captured.workspace?.projects[0].chats[0]).toEqual({
      chatId: "c1",
      title: "title-c1",
      status: "idle",
      unread: false,
      lastMessageAt: 10,
    })
  })

  test("a project carries only its own cron jobs, in the plugin's public shape", async () => {
    seedSidebar()
    useCronJobsStore.setState({ rows: [cronRow("/work/a", "c1", "job-a"), cronRow("/elsewhere", "c9", "job-x")] })
    const { socket } = connectedSocket()
    const captured = await mountSurface(socket)

    expect(captured.workspace?.projects[0].cronJobs).toEqual([
      {
        jobId: "job-a",
        chatId: "c1",
        instruction: "check ci",
        mode: "spawn",
        schedule: "every 5m",
        scheduleHuman: "every 5 minutes",
        paused: false,
        model: "claude-sonnet-4-5",
        nextFireAt: 301_000,
        lastRun: { status: "completed", firedAt: 1_000 },
      },
    ])
    expect(captured.workspace?.projects[1].cronJobs).toEqual([])
  })

  test("openChat navigates to the chat", async () => {
    const { socket } = connectedSocket()
    const captured = await mountSurface(socket)

    act(() => captured.workspace?.openChat("c1"))

    expect(captured.path).toBe("/chat/c1")
  })

  test("startChat with a prompt starts the chat with that prompt in one step and opens it", async () => {
    seedSidebar()
    const { socket, ws } = connectedSocket()
    const captured = await mountSurface(socket)

    act(() => captured.workspace?.startChat("/work/a", { prompt: "review the open PRs" }))
    await waitFor(() => ws.sent.length === 1, 2000, "chat.send command")

    expect(ws.sent[0].command).toMatchObject({ type: "chat.send", projectId: "p-a", content: "review the open PRs" })
    expect(captured.workspace?.starting).toBe(true)

    await act(async () => ws.ack(ws.sent[0].id, { chatId: "new-1" }))
    await waitFor(() => captured.path === "/chat/new-1", 2000, "navigation to the new chat")

    expect(captured.workspace?.starting).toBe(false)
    expect(ws.sent).toHaveLength(1)
  })

  test("startChat without a prompt creates an empty chat and opens it", async () => {
    seedSidebar()
    const { socket, ws } = connectedSocket()
    const captured = await mountSurface(socket)

    act(() => captured.workspace?.startChat("D:\\work\\b"))
    await waitFor(() => ws.sent.length === 1, 2000, "chat.create command")

    expect(ws.sent[0].command).toMatchObject({ type: "chat.create", projectId: "p-b" })

    await act(async () => ws.ack(ws.sent[0].id, { chatId: "new-2" }))
    await waitFor(() => captured.path === "/chat/new-2", 2000, "navigation to the new chat")
  })

  test("startChat for a folder the sidebar does not list opens that project first", async () => {
    seedSidebar()
    const { socket, ws } = connectedSocket()
    const captured = await mountSurface(socket)

    act(() => captured.workspace?.startChat("/work/unlisted", { prompt: "hello" }))
    await waitFor(() => ws.sent.length === 1, 2000, "project.open command")
    expect(ws.sent[0].command).toMatchObject({ type: "project.open", localPath: "/work/unlisted" })

    await act(async () => ws.ack(ws.sent[0].id, { projectId: "p-new" }))
    await waitFor(() => ws.sent.length === 2, 2000, "chat.send command")
    expect(ws.sent[1].command).toMatchObject({ type: "chat.send", projectId: "p-new", content: "hello" })
  })
})
