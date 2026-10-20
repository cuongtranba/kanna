import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { z } from "zod"
import { COMMAND_REGISTRY } from "../shared/commands"
import type { ClientCommand } from "../shared/protocol"
import { DEFAULT_KEYBINDINGS } from "../shared/types"
import { AppSettingsManager } from "./app-settings"
import { DiffStore } from "./diff-store"
import { KeybindingsManager } from "./keybindings"
import { readLlmProviderSnapshot, writeLlmProviderSnapshot } from "./llm-provider"
import { createTestEventStore } from "./storage/test-helpers"
import { makeTempRepo, type TempRepo } from "./test-helpers/worktree-repo"
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
})
