import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"
import { COMMAND_REGISTRY } from "../shared/commands"
import type { ClientCommand } from "../shared/protocol"
import { boardSchema, boardColumnSchema, cardSchema } from "../shared/commands/results/board"
import { DEFAULT_KEYBINDINGS } from "../shared/types"
import { AppSettingsManager } from "./app-settings"
import { createBoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import { DiffStore } from "./diff-store"
import { KeybindingsManager } from "./keybindings"
import { readLlmProviderSnapshot, writeLlmProviderSnapshot } from "./llm-provider"
import { createTestEventStore } from "./storage/test-helpers"
import { makeTempRepo, type TempRepo } from "./test-helpers/worktree-repo"
import { createWebhookHarness } from "./test-helpers/webhook-harness"
import { createWsRouter } from "./ws-router"

const repos: TempRepo[] = []
const settingsDirs: string[] = []

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup()
  for (const dir of settingsDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type RouterArgs = Parameters<typeof createWsRouter>[0]

const terminalsStub = {
  getSnapshot: () => null,
  onEvent: () => () => {},
  closeByCwd: () => {},
  write: () => {},
  resize: () => {},
  close: () => {},
  createTerminal: (args: { terminalId: string; cols: number; rows: number; scrollback: number; projectPath: string }) => ({
    terminalId: args.terminalId,
    title: "shell",
    cwd: args.projectPath,
    shell: "/bin/sh",
    cols: args.cols,
    rows: args.rows,
    scrollback: args.scrollback,
    serializedState: "",
    status: "running" as const,
    exitCode: null,
  }),
}

function createRouterOver(store: RouterArgs["store"], overrides: Partial<RouterArgs>) {
  return createWsRouter({
    store,
    agent: { getActiveStatuses: () => new Map(), getDrainingChatIds: () => new Set(), getWaitStartedAtByChatId: () => new Map() } as never,
    terminals: terminalsStub as never,
    keybindings: { getSnapshot: () => ({ bindings: DEFAULT_KEYBINDINGS, warning: null, filePathDisplay: "~/.kanna/keybindings.json" }), onChange: () => () => {} } as never,
    refreshDiscovery: async () => [],
    getDiscoveredProjects: () => [],
    machineDisplayName: "Local Machine",
    updateManager: null,
    pushManager: { getPreferences: () => ({ globalEnabled: true, mutedProjectPaths: [], mutedChatIds: [] }) } as never,
    ...overrides,
  })
}

async function createRouterOverRepo() {
  const repo = makeTempRepo()
  repos.push(repo)
  const store = createTestEventStore(`/command-results-${repo.dir}`)
  await store.initialize()
  const project = await store.openProject(repo.dir)
  const chat = await store.createChat(project.id)
  const router = createRouterOver(store, { diffStore: new DiffStore(repo.dir) })
  return { repo, router, store, chatId: chat.id, projectId: project.id }
}

async function createRouterOverSettings() {
  const dir = mkdtempSync(join(tmpdir(), "kanna-settings-results-"))
  settingsDirs.push(dir)
  const store = createTestEventStore(`/command-results-${dir}`)
  await store.initialize()
  const appSettings = new AppSettingsManager(join(dir, "settings.json"))
  await appSettings.initialize()
  const keybindings = new KeybindingsManager(join(dir, "keybindings.json"))
  await keybindings.initialize()
  const llmFile = join(dir, "llm-provider.json")
  const router = createRouterOver(store, {
    appSettings,
    keybindings,
    llmProvider: {
      read: () => readLlmProviderSnapshot(llmFile),
      write: (value) => writeLlmProviderSnapshot(value, llmFile),
      validate: async () => ({ ok: true, error: null }),
    },
    listOpenRouterModels: async () => [
      { id: "vendor/model", label: "Model", contextLength: 8192, pricing: { promptPerTok: 0.000001, completionPerTok: 0.000002 } },
    ],
  })
  return { router }
}

function resultSchemaOf(type: ClientCommand["type"]): z.ZodType | undefined {
  return COMMAND_REGISTRY.find((candidate) => candidate.type === type)?.result
}

async function expectAcksToMatchRegistry(router: ReturnType<typeof createWsRouter>, commands: readonly ClientCommand[]) {
  for (const command of commands) {
    const envelope = await router.dispatchCommand(command)
    const verdict = resultSchemaOf(command.type)?.safeParse(envelope.type === "ack" ? envelope.result : undefined)
    expect({ type: command.type, envelope: envelope.type, success: verdict?.success }).toEqual({ type: command.type, envelope: "ack", success: true })
  }
}

describe("command results", () => {
  test("the ack a git command's real handler sends parses with the result schema in the command registry", async () => {
    const { repo, router, chatId, projectId } = await createRouterOverRepo()
    writeFileSync(join(repo.dir, "kept.txt"), "kept\n")
    writeFileSync(join(repo.dir, "dropped.txt"), "dropped\n")
    writeFileSync(join(repo.dir, "later.txt"), "later\n")
    const commands: ClientCommand[] = [
      { type: "project.readDiffPatch", projectId, chatId, path: "kept.txt" },
      { type: "chat.listBranches", chatId },
      { type: "chat.createBranch", chatId, name: "feature" },
      { type: "chat.commitDiffs", chatId, paths: ["kept.txt"], summary: "add kept", mode: "commit_only" },
      { type: "chat.commitDiffs", chatId, paths: ["dropped.txt"], summary: "add dropped", mode: "commit_and_push" },
      { type: "chat.discardDiffFile", chatId, path: "later.txt" },
      { type: "chat.previewMergeBranch", chatId, branch: { kind: "local", name: "main" } },
    ]

    for (const command of commands) {
      const envelope = await router.dispatchCommand(command)

      expect(envelope.type).toBe("ack")
      const verdict = resultSchemaOf(command.type)?.safeParse(envelope.type === "ack" ? envelope.result : undefined)
      expect(verdict?.success).toBe(true)
    }
  }, 30_000)

  test("the ack a settings command's real handler sends parses with the result schema in the command registry", async () => {
    const { router } = await createRouterOverSettings()
    const commands: ClientCommand[] = [
      { type: "settings.readAppSettings" },
      {
        type: "settings.writeAppSettingsPatch",
        patch: {
          textSnippets: { create: { shortcut: "/hi", expansion: "hello" } },
          customModels: { create: { id: "my-model", label: "My model", provider: "claude", aliases: ["mine"] } },
        },
      },
      { type: "settings.writeAppSettings", analyticsEnabled: false },
      { type: "appSettings.setCloudflareTunnel", patch: { enabled: true } },
      { type: "appSettings.setClaudeAuth", patch: { concurrencyDefault: 2 } },
      { type: "appSettings.testOAuthToken", token: "" },
      { type: "settings.readKeybindings" },
      { type: "settings.writeKeybindings", bindings: DEFAULT_KEYBINDINGS },
      { type: "settings.readLlmProvider" },
      { type: "settings.writeLlmProvider", provider: "custom", apiKey: "secret", model: "m", baseUrl: "http://localhost:1234/v1" },
      { type: "settings.validateLlmProvider", provider: "openai", apiKey: "", model: "", baseUrl: "" },
      { type: "settings.listOpenRouterModels" },
      { type: "settings.testMcpServer", id: "missing" },
      { type: "settings.startMcpOAuth", id: "missing" },
      { type: "settings.completeMcpOAuth", id: "missing", callbackUrl: "http://localhost/callback" },
      { type: "beacons.mintPairingCode" },
      { type: "beacons.update", beaconId: "missing" },
      { type: "update.check" },
    ]

    for (const command of commands) {
      const envelope = await router.dispatchCommand(command)

      expect(envelope.type).toBe("ack")
      const verdict = resultSchemaOf(command.type)?.safeParse(envelope.type === "ack" ? envelope.result : undefined)
      expect({ type: command.type, success: verdict?.success }).toEqual({ type: command.type, success: true })
    }
  }, 30_000)

  test("the ack of a subagent command's real handler parses with the result schema in the command registry", async () => {
    const { router } = await createRouterOverSettings()
    const created = await router.dispatchCommand({
      type: "subagent.create",
      input: {
        name: "reviewer",
        provider: "claude",
        model: "claude-sonnet-4-5",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        systemPrompt: "Review the change.",
        contextScope: "previous-assistant-reply",
      },
    })
    const duplicate = await router.dispatchCommand({
      type: "subagent.create",
      input: {
        name: "reviewer",
        provider: "claude",
        model: "claude-sonnet-4-5",
        modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
        systemPrompt: "Review the change.",
        contextScope: "previous-assistant-reply",
      },
    })
    const createdResult = created.type === "ack" ? created.result : undefined
    const subagentId = createdResult && typeof createdResult === "object" && "subagent" in createdResult && createdResult.subagent && typeof createdResult.subagent === "object" && "id" in createdResult.subagent && typeof createdResult.subagent.id === "string"
      ? createdResult.subagent.id
      : ""
    const updated = await router.dispatchCommand({ type: "subagent.update", id: subagentId, patch: { systemPrompt: "Review harder." } })
    const deleted = await router.dispatchCommand({ type: "subagent.delete", id: subagentId })

    expect(subagentId).not.toBe("")
    for (const [type, envelope] of [
      ["subagent.create", created],
      ["subagent.create", duplicate],
      ["subagent.update", updated],
      ["subagent.delete", deleted],
    ] as const) {
      expect(envelope.type).toBe("ack")
      expect(resultSchemaOf(type)?.safeParse(envelope.type === "ack" ? envelope.result : undefined).success).toBe(true)
    }
    expect(duplicate.type === "ack" && duplicate.result).toMatchObject({ ok: false })
  }, 30_000)

  test("the ack of a project, stack, skill and package command's real handler parses with the result schema in the command registry", async () => {
    const { router, store, projectId } = await createRouterOverRepo()
    const created = mkdtempSync(join(tmpdir(), "kanna-project-results-"))
    settingsDirs.push(created)
    const sibling = await store.openProject(created)
    const third = await store.openProject(mkdtempSync(join(created, "third-")))
    const stackProjectIds = [projectId, sibling.id, third.id]
    const stack = await router.dispatchCommand({ type: "stack.create", title: "trio", projectIds: stackProjectIds })
    const stackId = stack.type === "ack" && stack.result && typeof stack.result === "object" && "stackId" in stack.result ? String(stack.result.stackId) : ""

    expect(stackId).not.toBe("")
    await expectAcksToMatchRegistry(router, [
      { type: "stack.create", title: "trio", projectIds: stackProjectIds },
      { type: "stack.listWorktrees", projectId },
      { type: "stack.rename", stackId, title: "renamed" },
      { type: "stack.setInstructions", stackId, instructions: "be brief" },
      { type: "stack.removeProject", stackId, projectId: third.id },
      { type: "stack.addProject", stackId, projectId: third.id },
      { type: "stack.remove", stackId },
      { type: "project.open", localPath: created },
      { type: "project.create", localPath: join(created, "fresh"), title: "Fresh" },
      { type: "project.setStar", projectId, starred: true },
      { type: "project.setInstructions", projectId, instructions: "be careful" },
      { type: "sidebar.reorderProjectGroups", projectIds: [projectId] },
      { type: "sessions.importClaudeSession", sessionIds: [] },
      { type: "skills.listInstalled" },
      { type: "packages.listInstalled" },
      { type: "packages.checkUpdates" },
      { type: "packages.update", id: "missing" },
      { type: "system.ping" },
      { type: "terminal.create", projectId, terminalId: "t1", cols: 80, rows: 24, scrollback: 1000 },
      { type: "terminal.input", terminalId: "t1", data: "ls\n" },
      { type: "terminal.resize", terminalId: "t1", cols: 100, rows: 30 },
      { type: "terminal.close", terminalId: "t1" },
      { type: "project.remove", projectId },
      { type: "project.delete", projectId: sibling.id },
    ])
  }, 60_000)

  test("the ack of a chat, transcript and tunnel command's real handler parses with the result schema in the command registry", async () => {
    const { router, store, chatId, projectId } = await createRouterOverRepo()
    await store.appendMessage(chatId, { _id: "u1", createdAt: 1, kind: "user_prompt", content: "list files" })
    await store.appendMessage(chatId, {
      _id: "c1",
      createdAt: 2,
      kind: "tool_call",
      tool: { kind: "tool", toolKind: "bash", toolName: "Bash", toolId: "tool-1", input: { command: "ls", runInBackground: false } },
    })
    await store.appendMessage(chatId, { _id: "r1", createdAt: 3, kind: "tool_result", toolId: "tool-1", content: "a.txt" })
    await store.appendMessage(chatId, { _id: "a1", createdAt: 4, kind: "assistant_text", text: "done" })

    await expectAcksToMatchRegistry(router, [
      { type: "chat.create", projectId },
      { type: "chat.loadHistory", chatId, beforeCursor: "idx:4", limit: 2 },
      { type: "chat.rename", chatId, title: "Renamed" },
      { type: "chat.markRead", chatId },
      { type: "chat.setPolicyOverride", chatId, policyOverride: { defaultAction: "ask" } },
      { type: "chat.setDraftProtection", chatIds: [chatId] },
      { type: "chat.archive", chatId },
      { type: "chat.unarchive", chatId },
      { type: "workflows.getRun", chatId, runId: "missing" },
      { type: "workflows.getAgentTranscript", chatId, runId: "missing", agentId: "none" },
      { type: "subagents.getRun", chatId, agentId: "none" },
      { type: "tunnel.accept", chatId, tunnelId: "t1" },
      { type: "tunnel.stop", chatId, tunnelId: "t1" },
      { type: "tunnel.retry", chatId, tunnelId: "t1" },
    ])
  }, 30_000)

  test("the background task output a chat command answers with parses as the snapshot the registry declares", async () => {
    const { router, chatId } = await createRouterOverRepo()

    const envelope = await router.dispatchCommand({ type: "backgroundTasks.getOutput", chatId, taskId: "task-1" })

    expect(envelope.type).toBe("snapshot")
    const reply = envelope.type === "snapshot" ? envelope.snapshot : undefined
    expect(resultSchemaOf("backgroundTasks.getOutput")?.safeParse(reply).success).toBe(true)
  }, 30_000)

  test("the ack of a board command's real handler parses with the result schema in the command registry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kanna-board-results-"))
    settingsDirs.push(dir)
    const store = createTestEventStore(`/board-results-${dir}`)
    await store.initialize()
    const project = await store.openProject(dir)
    const boardRegistry = createBoardRegistry({ store: createBoardStore({ filePath: ":memory:" }) })
    const router = createRouterOver(store, { boardRegistry })
    const resultOf = async (command: ClientCommand) => {
      const envelope = await router.dispatchCommand(command)
      return envelope.type === "ack" ? envelope.result : undefined
    }

    const board = boardSchema.parse(await resultOf({ type: "board.create", ownerKind: "project", ownerId: project.id, title: "Release" }))
    const column = boardColumnSchema.parse(await resultOf({ type: "board.column.create", boardId: board.id, title: "QA" }))
    const first = cardSchema.parse(await resultOf({ type: "board.card.create", boardId: board.id, columnId: column.id, title: "Ship it" }))
    const second = cardSchema.parse(await resultOf({ type: "board.card.create", boardId: board.id, columnId: column.id, title: "Announce it" }))

    await expectAcksToMatchRegistry(router, [
      { type: "board.update", boardId: board.id, title: "Release 2" },
      { type: "board.duplicate", boardId: board.id, title: "Release copy" },
      { type: "board.saveAsTemplate", boardId: board.id, name: "Release template" },
      { type: "board.templates.list" },
      { type: "board.column.update", columnId: column.id, title: "Verification" },
      { type: "board.column.move", columnId: column.id, afterColumnId: null },
      { type: "board.card.update", cardId: first.id, title: "Ship it today" },
      { type: "board.card.comment", cardId: first.id, body: "On it" },
      { type: "board.card.detail", cardId: first.id },
      { type: "board.card.detail", cardId: "missing" },
      { type: "board.card.move", cardId: second.id, toColumnId: column.id, aboveCardId: first.id, belowCardId: null },
      { type: "board.card.block", cardId: second.id, blockedByCardId: first.id },
      { type: "board.card.unblock", cardId: second.id, blockedByCardId: first.id },
      { type: "board.cards.page", columnId: column.id, limit: 10 },
      { type: "board.sync.status", boardId: board.id },
      { type: "board.sync.bind", boardId: board.id, owner: "octo", repo: "kanna", direction: "pull", allowAgentPush: false },
      { type: "board.card.archive", cardId: second.id },
      { type: "board.column.create", boardId: board.id, title: "Done" },
      { type: "board.archive", boardId: board.id },
    ])
  }, 30_000)

  test("the ack of an inbox, webhook, share and push command's real handler parses with the result schema in the command registry", async () => {
    const { store, inbox, registry, chat } = await createWebhookHarness()
    const pushManager = {
      getPreferences: () => ({ globalEnabled: true, mutedProjectPaths: [], mutedChatIds: [] }),
      recordDeviceSeen: async () => {},
      addSubscription: async () => ({ id: "device-1" }),
      removeSubscription: async () => {},
      sendTest: async () => {},
      setProjectMute: async () => {},
      setChatMute: async () => {},
      setFocusedChat: () => {},
    }
    const router = createRouterOver(store, {
      webhooks: registry,
      inbox,
      inboxReply: async () => ({ ok: true, chatId: "chat-1" }),
      inboxInstruct: async () => ({ ok: true, chatId: "chat-1" }),
      pushManager: pushManager as never,
    })
    const created = await router.dispatchCommand({
      type: "webhooks.create",
      input: { name: "ci", mode: "notify", chatId: chat.id, template: "build {{status}}" },
    })
    const createdResult = created.type === "ack" ? created.result : undefined
    const hookId = createdResult && typeof createdResult === "object" && "hook" in createdResult ? createdResult.hook.id : ""

    expect(hookId).not.toBe("")
    await expectAcksToMatchRegistry(router, [
      { type: "webhooks.create", input: { name: "deploy", mode: "notify", chatId: chat.id, template: "deploy {{status}}" } },
      { type: "webhooks.update", id: hookId, patch: { enabled: false } },
      { type: "webhooks.rotateSecret", id: hookId },
      { type: "webhooks.delete", id: hookId },
      { type: "inbox.page", beforeTs: Date.now() + 1000, limit: 20 },
      { type: "inbox.markRead", ids: ["thread-1"] },
      { type: "inbox.markAllRead" },
      { type: "inbox.archive", threadId: "thread-1" },
      { type: "inbox.reply", threadId: "thread-1", text: "thanks" },
      { type: "inbox.instruct", threadId: "thread-1", text: "look into it" },
      { type: "share.mint", payload: { chatId: "chat-1" } },
      { type: "share.revoke", payload: { tokenId: "token-1" } },
      { type: "share.list", payload: { chatId: "chat-1" } },
      { type: "push.subscribe", subscription: { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }, label: "laptop", userAgent: "test" },
      { type: "push.identifyDevice", pushDeviceId: "device-1" },
      { type: "push.test" },
      { type: "push.setProjectMute", localPath: "/tmp/project", muted: true },
      { type: "push.setChatMute", chatId: "chat-1", muted: true },
      { type: "push.setFocusedChat", chatId: "chat-1" },
      { type: "push.unsubscribe", pushDeviceId: "device-1" },
    ])
  }, 30_000)
})
