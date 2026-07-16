import { describe, expect, mock, test } from "bun:test"
import type { DiffCommandDeps, DiffStoreDep } from "./ws-router-diff"
import { handleDiffCommand } from "./ws-router-diff"
import type { ClientCommand } from "../shared/protocol"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<DiffStoreDep> = {}): DiffStoreDep {
  return {
    refreshSnapshot: mock(async () => false),
    initializeGit: mock(async () => ({ ok: true as const, branchName: "main", snapshotChanged: false })),
    getGitHubPublishInfo: mock(async () => ({
      ghInstalled: false,
      authenticated: false,
      activeAccountLogin: undefined,
      owners: [],
      suggestedRepoName: "my-repo",
    })),
    checkGitHubRepoAvailability: mock(async () => ({ available: true, message: "" })),
    publishToGitHub: mock(async () => ({ ok: false, title: "", message: "", snapshotChanged: false })),
    listBranches: mock(async () => ({ recent: [], local: [], remote: [], pullRequests: [], pullRequestsStatus: "unavailable" as const })),
    previewMergeBranch: mock(async () => ({
      currentBranchName: "main",
      targetBranchName: "feat",
      targetDisplayName: "feat",
      status: "ok" as const,
      commitCount: 1,
      hasConflicts: false,
      message: undefined,
    })),
    mergeBranch: mock(async () => ({ ok: true as const, title: "", message: "", snapshotChanged: false })),
    checkoutBranch: mock(async () => ({ ok: true as const, branchName: "main", snapshotChanged: false })),
    syncBranch: mock(async () => ({ ok: true as const, action: "fetch" as const, branchName: "main", snapshotChanged: false })),
    createBranch: mock(async () => ({ ok: true as const, branchName: "new-branch", snapshotChanged: false })),
    generateCommitMessage: mock(async () => ({ subject: "Update", body: "", usedFallback: false, failureMessage: null })),
    commitFiles: mock(async () => ({ ok: true as const, mode: "commit_only" as const, branchName: "main", pushed: false, snapshotChanged: false })),
    discardFile: mock(async () => ({ snapshotChanged: false })),
    ignoreFile: mock(async () => ({ snapshotChanged: false })),
    ...overrides,
  }
}

function makeDeps(storeOverrides?: Partial<DiffStoreDep>): DiffCommandDeps & { sent: unknown[]; broadcastCount: number } {
  const sent: unknown[] = []
  let broadcastCount = 0
  return {
    resolvedDiffStore: makeStore(storeOverrides),
    resolveChatProject: (chatId) => ({ project: { id: `proj-${chatId}`, localPath: `/tmp/${chatId}` } }),
    send: (envelope) => { sent.push(envelope) },
    broadcastSnapshots: () => { broadcastCount++ },
    sent,
    get broadcastCount() { return broadcastCount },
  }
}

// ---------------------------------------------------------------------------
// Unrecognized command
// ---------------------------------------------------------------------------

describe("handleDiffCommand", () => {
  test("returns false for a non-diff command", async () => {
    const deps = makeDeps()
    const handled = await handleDiffCommand(deps, { type: "settings.readAppSettings" } as unknown as ClientCommand, "r0")
    expect(handled).toBe(false)
    expect(deps.sent).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // chat.refreshDiffs
  // ---------------------------------------------------------------------------

  test("chat.refreshDiffs — acks and does NOT broadcast when unchanged", async () => {
    const deps = makeDeps({ refreshSnapshot: mock(async () => false) })
    const handled = await handleDiffCommand(deps, { type: "chat.refreshDiffs", chatId: "c1" }, "r1")
    expect(handled).toBe(true)
    expect(deps.sent).toHaveLength(1)
    expect((deps.sent[0] as { type: string }).type).toBe("ack")
    expect(deps.broadcastCount).toBe(0)
  })

  test("chat.refreshDiffs — broadcasts when snapshot changed", async () => {
    const deps = makeDeps({ refreshSnapshot: mock(async () => true) })
    await handleDiffCommand(deps, { type: "chat.refreshDiffs", chatId: "c1" }, "r2")
    expect(deps.broadcastCount).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // chat.initGit
  // ---------------------------------------------------------------------------

  test("chat.initGit — acks with result", async () => {
    const deps = makeDeps()
    const handled = await handleDiffCommand(deps, { type: "chat.initGit", chatId: "c1" }, "r3")
    expect(handled).toBe(true)
    const ack = deps.sent[0] as { result: { ok: boolean } }
    expect(ack.result.ok).toBe(true)
  })

  test("chat.initGit — broadcasts when snapshotChanged", async () => {
    const deps = makeDeps({ initializeGit: mock(async () => ({ ok: true as const, branchName: "main", snapshotChanged: true })) })
    await handleDiffCommand(deps, { type: "chat.initGit", chatId: "c1" }, "r4")
    expect(deps.broadcastCount).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // chat.getGitHubPublishInfo — no broadcast ever
  // ---------------------------------------------------------------------------

  test("chat.getGitHubPublishInfo — acks and never broadcasts", async () => {
    const deps = makeDeps()
    const handled = await handleDiffCommand(deps, { type: "chat.getGitHubPublishInfo", chatId: "c1" }, "r5")
    expect(handled).toBe(true)
    expect(deps.broadcastCount).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // chat.checkGitHubRepoAvailability — does not need chatId
  // ---------------------------------------------------------------------------

  test("chat.checkGitHubRepoAvailability — acks without project lookup", async () => {
    const resolveSpy = mock((chatId: string) => ({ project: { id: `proj-${chatId}`, localPath: `/tmp/${chatId}` } }))
    const deps = { ...makeDeps(), resolveChatProject: resolveSpy }
    const handled = await handleDiffCommand(
      deps,
      { type: "chat.checkGitHubRepoAvailability", chatId: "c1", owner: "my-org", name: "my-repo" },
      "r6",
    )
    expect(handled).toBe(true)
    // resolveChatProject should NOT have been called — this command doesn't need a chatId
    expect(resolveSpy).not.toHaveBeenCalled()
  })

  // ---------------------------------------------------------------------------
  // chat.commitDiffs — broadcasts on snapshotChanged
  // ---------------------------------------------------------------------------

  test("chat.commitDiffs — broadcasts when snapshot changed", async () => {
    const deps = makeDeps({
      commitFiles: mock(async () => ({ ok: true as const, mode: "commit_only" as const, branchName: "main", pushed: false, snapshotChanged: true })),
    })
    await handleDiffCommand(
      deps,
      { type: "chat.commitDiffs", chatId: "c1", paths: ["src/foo.ts"], summary: "Fix", description: "", mode: "commit_only" },
      "r7",
    )
    expect(deps.broadcastCount).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // chat.discardDiffFile / chat.ignoreDiffFile — no broadcast when unchanged
  // ---------------------------------------------------------------------------

  test("chat.discardDiffFile — does not broadcast when snapshotChanged is false", async () => {
    const deps = makeDeps({ discardFile: mock(async () => ({ snapshotChanged: false })) })
    const handled = await handleDiffCommand(deps, { type: "chat.discardDiffFile", chatId: "c1", path: "src/foo.ts" }, "r8")
    expect(handled).toBe(true)
    expect(deps.broadcastCount).toBe(0)
  })

  test("chat.ignoreDiffFile — broadcasts when snapshotChanged is true", async () => {
    const deps = makeDeps({ ignoreFile: mock(async () => ({ snapshotChanged: true })) })
    await handleDiffCommand(deps, { type: "chat.ignoreDiffFile", chatId: "c1", path: "src/foo.ts" }, "r9")
    expect(deps.broadcastCount).toBe(1)
  })
})
