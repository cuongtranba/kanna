import { z } from "zod"
import { fail } from "../kanna-mcp-tool"
import { commandTool, topicTool, type RemoteTool } from "./remote-mcp-tool-spec"
import { jsonResult, readChat, runCommand } from "./remote-mcp-views"

const BRANCH_CHOICE_MESSAGE = "Give exactly one of branch (a branch object from list_branches) or the legacy name (a local branch name)."

function exactlyOneBranch(args: { branch?: object; name?: string }, ctx: z.RefinementCtx): void {
  if ((args.branch === undefined) === (args.name === undefined)) ctx.addIssue({ code: "custom", message: BRANCH_CHOICE_MESSAGE })
}

export const gitTools: readonly RemoteTool[] = [
  topicTool({
    name: "get_git_status",
    title: "Git status",
    description: "Refresh and read the git state of a chat's working directory: branch, ahead/behind counts and changed files.",
    annotations: { readOnlyHint: true },
    topic: "project-git",
    commands: ["chat.refreshDiffs"],
    input: z.object({ chatId: z.string().describe("Id of the chat whose working directory is the repository") }),
    handle: async ({ chatId }, { host }) => {
      const chat = readChat(host, chatId, 1)
      if (!chat) return fail(`Chat ${chatId} was not found.`)
      const refreshed = await runCommand(host, { type: "chat.refreshDiffs", chatId })
      if (!refreshed.ok) return fail(refreshed.message)
      const envelope = host.readSnapshot({ type: "project-git", projectId: chat.runtime.projectId, chatId })
      if (envelope.type !== "snapshot" || envelope.snapshot.type !== "project-git") return fail("The git snapshot is unavailable.")
      const git = envelope.snapshot.data
      if (!git) return fail("This chat has no git repository.")
      return jsonResult({
        branch: git.branchName ?? null,
        status: git.status,
        aheadCount: git.aheadCount,
        behindCount: git.behindCount,
        files: git.files.map((file) => ({
          path: file.path,
          status: file.isUntracked ? "untracked" : file.changeType,
          additions: file.additions,
          deletions: file.deletions,
        })),
      })
    },
  }),
  commandTool({
    name: "commit_changes",
    title: "Commit changes",
    description: "Commit the given changed files of a chat's repository. Mode commit_and_push also pushes the branch.",
    command: "chat.commitDiffs",
    input: (params) => params.extend({
      mode: params.shape.mode.optional().describe("commit_only (default) or commit_and_push. Optional for compatibility with clients that never sent it"),
    }),
    handle: ({ mode, ...args }, { run }) => run({ type: "chat.commitDiffs", ...args, mode: mode ?? "commit_only" }),
  }),
  commandTool({
    name: "list_branches",
    title: "List branches",
    description: "List the local, remote and pull-request branches of a chat's repository and the current branch.",
    annotations: { readOnlyHint: true },
    command: "chat.listBranches",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.listBranches", ...args }),
  }),
  commandTool({
    name: "checkout_branch",
    title: "Check out a branch",
    description: "Switch a chat's repository to a local, remote or pull-request branch, optionally carrying uncommitted changes along. Take the branch object from list_branches.",
    command: "chat.checkoutBranch",
    input: (params) => params
      .extend({
        branch: params.shape.branch.optional().describe(`${params.shape.branch.description ?? "The branch"}. Give this or the legacy name, not both`),
        name: z.string().optional().describe("Legacy, accepted for compatibility: the name of a local branch, the same as branch {kind: local, name}"),
      })
      .superRefine(exactlyOneBranch),
    handle: ({ name, branch, ...args }, { run }) => {
      const target = branch ?? (name === undefined ? undefined : { kind: "local" as const, name })
      return target ? run({ type: "chat.checkoutBranch", ...args, branch: target }) : fail(BRANCH_CHOICE_MESSAGE)
    },
  }),
  commandTool({
    name: "sync_branch",
    title: "Sync a branch",
    description: "Fetch, pull, push or publish the current branch of a chat's repository.",
    command: "chat.syncBranch",
    input: (params) => params,
    handle: (args, { run }) => run({ type: "chat.syncBranch", ...args }),
  }),
]
