import { z } from "zod"
import { defineCommand, defineCommands, noResult, REMOTE_ALLOWED } from "./define"
import { chatIdParams, chatIdShape } from "./fragments"
import {
  branchActionResultSchema,
  chatBranchListResultSchema,
  chatBranchRefSchema,
  chatCreateBranchResultSchema,
  chatMergePreviewResultSchema,
  chatSyncResultSchema,
  diffCommitModeSchema,
  diffCommitResultSchema,
  generateCommitMessageResultSchema,
  gitHubPublishInfoSchema,
  gitHubRepoAvailabilityResultSchema,
  gitRepoVisibilitySchema,
  gitSyncActionSchema,
  snapshotChangedResultSchema,
} from "../git-diff-types.schema"

const chatAndPathParams = z.object({ ...chatIdShape, path: z.string() })
const branchRefField = chatBranchRefSchema.describe("The branch: kind local, remote (with remoteRef) or pull_request (with prNumber and headRefName)")
const chatAndBranchParams = z.object({ ...chatIdShape, branch: branchRefField })

export const gitCommands = defineCommands(
  defineCommand("chat.refreshDiffs", {
    result: noResult,
    params: chatIdParams,
    summary: "Recompute the git diff snapshot of a chat.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.initGit", {
    params: chatIdParams,
    result: branchActionResultSchema,
    summary: "Run git init in the chat's working directory.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.getGitHubPublishInfo", {
    params: chatIdParams,
    result: gitHubPublishInfoSchema,
    summary: "Read whether and how the chat's repository can be published to GitHub.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.checkGitHubRepoAvailability", {
    params: z.object({ ...chatIdShape, owner: z.string(), name: z.string() }),
    result: gitHubRepoAvailabilityResultSchema,
    summary: "Check whether a GitHub repository name is free.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.publishToGitHub", {
    params: z.object({
      ...chatIdShape,
      owner: z.string(),
      name: z.string(),
      visibility: gitRepoVisibilitySchema,
      description: z.string().optional(),
    }),
    result: branchActionResultSchema,
    summary: "Create a GitHub repository and push the chat's repository to it.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.listBranches", {
    params: chatIdParams,
    result: chatBranchListResultSchema,
    summary: "List local, remote and pull-request branches of the chat's repository.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.previewMergeBranch", {
    params: chatAndBranchParams,
    result: chatMergePreviewResultSchema,
    summary: "Preview the result of merging a branch.",
    risk: "read",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.mergeBranch", {
    params: chatAndBranchParams,
    result: branchActionResultSchema,
    summary: "Merge a branch into the current branch.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.syncBranch", {
    params: z.object({ ...chatIdShape, action: gitSyncActionSchema.describe("Which sync to perform") }),
    result: chatSyncResultSchema,
    summary: "Fetch, pull, push or publish the current branch.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.checkoutBranch", {
    params: z.object({ ...chatIdShape, branch: branchRefField, bringChanges: z.boolean().optional().describe("Carry uncommitted changes to the branch") }),
    result: branchActionResultSchema,
    summary: "Check out a branch, optionally carrying uncommitted changes.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.createBranch", {
    params: z.object({ ...chatIdShape, name: z.string(), baseBranchName: z.string().optional() }),
    result: chatCreateBranchResultSchema,
    summary: "Create and check out a new branch.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.generateCommitMessage", {
    params: z.object({ ...chatIdShape, paths: z.array(z.string()) }),
    result: generateCommitMessageResultSchema,
    summary: "Generate a commit message for the given changed files.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.commitDiffs", {
    params: z.object({
      ...chatIdShape,
      paths: z.array(z.string()).describe("Repository-relative paths of the files to commit"),
    summary: z.string().describe("Commit subject line"),
      description: z.string().optional().describe("Commit body"),
      mode: diffCommitModeSchema.describe("commit_only, or commit_and_push to push the branch too"),
    }),
    result: diffCommitResultSchema,
    summary: "Commit the given changed files.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.discardDiffFile", {
    params: chatAndPathParams,
    result: snapshotChangedResultSchema,
    summary: "Discard the uncommitted changes of one file.",
    risk: "destructive",
    remote: REMOTE_ALLOWED,
  }),
  defineCommand("chat.ignoreDiffFile", {
    params: chatAndPathParams,
    result: snapshotChangedResultSchema,
    summary: "Add one file to the repository's ignore list.",
    risk: "write",
    remote: REMOTE_ALLOWED,
  }),
)
