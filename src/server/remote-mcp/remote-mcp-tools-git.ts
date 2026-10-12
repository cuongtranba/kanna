import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { fail } from "../kanna-mcp-tool"
import type { RemoteMcpHost } from "./remote-mcp-server"
import { commandResult, jsonResult, readChat, runCommand } from "./remote-mcp-views"

const chatIdField = z.string().describe("Id of the chat whose working directory is the repository")

export function registerGitTools(server: McpServer, host: RemoteMcpHost): void {
  server.registerTool(
    "get_git_status",
    {
      title: "Git status",
      description: "Refresh and read the git state of a chat's working directory: branch, ahead/behind counts and changed files.",
      inputSchema: z.object({ chatId: chatIdField }),
      annotations: { readOnlyHint: true },
    },
    async ({ chatId }) => {
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
  )

  server.registerTool(
    "commit_changes",
    {
      title: "Commit changes",
      description: "Commit the given changed files of a chat's repository. Mode commit_and_push also pushes the branch.",
      inputSchema: z.object({
        chatId: chatIdField,
        paths: z.array(z.string()).min(1).describe("Repository-relative paths of the files to commit"),
        summary: z.string().describe("Commit subject line"),
        description: z.string().optional().describe("Commit body"),
        mode: z.enum(["commit_only", "commit_and_push"]).optional().describe("commit_only (default) or commit_and_push"),
      }),
    },
    ({ chatId, paths, summary, description, mode }) =>
      commandResult(host, { type: "chat.commitDiffs", chatId, paths, summary, description, mode: mode ?? "commit_only" }),
  )

  server.registerTool(
    "list_branches",
    {
      title: "List branches",
      description: "List the local, remote and pull-request branches of a chat's repository and the current branch.",
      inputSchema: z.object({ chatId: chatIdField }),
      annotations: { readOnlyHint: true },
    },
    ({ chatId }) => commandResult(host, { type: "chat.listBranches", chatId }),
  )

  server.registerTool(
    "checkout_branch",
    {
      title: "Check out a branch",
      description: "Switch a chat's repository to a local branch, optionally carrying uncommitted changes along.",
      inputSchema: z.object({
        chatId: chatIdField,
        name: z.string().describe("Name of the local branch"),
        bringChanges: z.boolean().optional().describe("Carry uncommitted changes to the branch"),
      }),
    },
    ({ chatId, name, bringChanges }) =>
      commandResult(host, { type: "chat.checkoutBranch", chatId, branch: { kind: "local", name }, bringChanges }),
  )

  server.registerTool(
    "sync_branch",
    {
      title: "Sync a branch",
      description: "Fetch, pull, push or publish the current branch of a chat's repository.",
      inputSchema: z.object({
        chatId: chatIdField,
        action: z.enum(["fetch", "pull", "push", "publish"]).describe("Which sync to perform"),
      }),
    },
    ({ chatId, action }) => commandResult(host, { type: "chat.syncBranch", chatId, action }),
  )
}
