import { afterEach, describe, expect, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { COMMAND_REGISTRY } from "../shared/commands"
import type { ClientCommand } from "../shared/protocol"
import { DEFAULT_KEYBINDINGS } from "../shared/types"
import { DiffStore } from "./diff-store"
import { createTestEventStore } from "./storage/test-helpers"
import { makeTempRepo, type TempRepo } from "./test-helpers/worktree-repo"
import { createWsRouter } from "./ws-router"

const repos: TempRepo[] = []

afterEach(() => {
  for (const repo of repos.splice(0)) repo.cleanup()
})

async function createRouterOverRepo() {
  const repo = makeTempRepo()
  repos.push(repo)
  const store = createTestEventStore(`/command-results-${repo.dir}`)
  await store.initialize()
  const project = await store.openProject(repo.dir)
  const chat = await store.createChat(project.id)
  const router = createWsRouter({
    store,
    diffStore: new DiffStore(repo.dir),
    agent: { getActiveStatuses: () => new Map(), getDrainingChatIds: () => new Set(), getWaitStartedAtByChatId: () => new Map() } as never,
    terminals: { getSnapshot: () => null, onEvent: () => () => {} } as never,
    keybindings: { getSnapshot: () => ({ bindings: DEFAULT_KEYBINDINGS, warning: null, filePathDisplay: "~/.kanna/keybindings.json" }), onChange: () => () => {} } as never,
    refreshDiscovery: async () => [],
    getDiscoveredProjects: () => [],
    machineDisplayName: "Local Machine",
    updateManager: null,
    pushManager: { getPreferences: () => ({ globalEnabled: true, mutedProjectPaths: [], mutedChatIds: [] }) } as never,
  })
  return { repo, router, chatId: chat.id, projectId: project.id }
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
      const definition = COMMAND_REGISTRY.find((candidate) => candidate.type === command.type)
      const envelope = await router.dispatchCommand(command)

      expect(envelope.type).toBe("ack")
      const verdict = definition?.result?.safeParse(envelope.type === "ack" ? envelope.result : undefined)
      expect(verdict?.success).toBe(true)
    }
  }, 30_000)
})
