import { z } from "zod"
import type {
  BranchActionFailure,
  BranchActionSuccess,
  ChatBranchListResult,
  ChatCheckoutBranchResult,
  ChatCreateBranchResult,
  ChatMergeBranchResult,
  ChatMergePreviewResult,
  ChatSyncResult,
  DiffCommitMode,
  DiffCommitResult,
  GitHubPublishInfo,
  GitHubRepoAvailabilityResult,
} from "./git-diff-types"
import { assertParity } from "./type-parity"

export const diffCommitModeSchema = z.enum(["commit_and_push", "commit_only"])

export const chatBranchRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), name: z.string() }),
  z.object({ kind: z.literal("remote"), name: z.string(), remoteRef: z.string() }),
  z.object({
    kind: z.literal("pull_request"),
    name: z.string(),
    prNumber: z.number(),
    headRefName: z.string(),
    headRepoCloneUrl: z.string().optional(),
    isCrossRepository: z.boolean().optional(),
    remoteRef: z.string().optional(),
  }),
])

export const gitSyncActionSchema = z.enum(["fetch", "pull", "push", "publish"])

assertParity<z.output<typeof diffCommitModeSchema>, DiffCommitMode>()

const branchActionSuccessShape = {
  ok: z.literal(true),
  branchName: z.string().optional(),
  snapshotChanged: z.boolean(),
}

const branchActionFailureShape = {
  ok: z.literal(false),
  title: z.string(),
  message: z.string(),
  detail: z.string().optional(),
  cancelled: z.boolean().optional(),
  snapshotChanged: z.boolean().optional(),
}

const branchActionSuccessSchema = z.object(branchActionSuccessShape)
const branchActionFailureSchema = z.object(branchActionFailureShape)

export const branchActionResultSchema = z.discriminatedUnion("ok", [branchActionSuccessSchema, branchActionFailureSchema])

export const snapshotChangedResultSchema = z.object({ snapshotChanged: z.boolean() })

export const diffPatchResultSchema = z.object({ patch: z.string() })

export const chatSyncResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ...branchActionSuccessShape,
    action: gitSyncActionSchema,
    aheadCount: z.number().optional(),
    behindCount: z.number().optional(),
  }),
  z.object({ ...branchActionFailureShape, action: gitSyncActionSchema }),
])

export const diffCommitResultSchema = z.discriminatedUnion("ok", [
  z.object({ ...branchActionSuccessShape, mode: diffCommitModeSchema, pushed: z.boolean() }),
  z.object({
    ...branchActionFailureShape,
    mode: diffCommitModeSchema,
    phase: z.enum(["commit", "push"]),
    localCommitCreated: z.boolean().optional(),
  }),
])

export const chatCreateBranchResultSchema = z.discriminatedUnion("ok", [
  z.object({ ...branchActionSuccessShape, branchName: z.string() }),
  branchActionFailureSchema,
])

export const chatMergePreviewResultSchema = z.object({
  currentBranchName: z.string().optional(),
  targetBranchName: z.string(),
  targetDisplayName: z.string(),
  status: z.enum(["up_to_date", "mergeable", "conflicts", "error"]),
  commitCount: z.number(),
  hasConflicts: z.boolean(),
  message: z.string(),
  detail: z.string().optional(),
})

const chatBranchListEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["local", "remote", "pull_request"]),
  name: z.string(),
  displayName: z.string(),
  updatedAt: z.string().optional(),
  description: z.string().optional(),
  remoteRef: z.string().optional(),
  prNumber: z.number().optional(),
  prTitle: z.string().optional(),
  headRefName: z.string().optional(),
  headLabel: z.string().optional(),
  headRepoCloneUrl: z.string().optional(),
  isCrossRepository: z.boolean().optional(),
})

export const chatBranchListResultSchema = z.object({
  currentBranchName: z.string().optional(),
  defaultBranchName: z.string().optional(),
  recent: z.array(chatBranchListEntrySchema),
  local: z.array(chatBranchListEntrySchema),
  remote: z.array(chatBranchListEntrySchema),
  pullRequests: z.array(chatBranchListEntrySchema),
  pullRequestsStatus: z.enum(["available", "unavailable", "error"]),
  pullRequestsError: z.string().optional(),
})

export const gitHubPublishInfoSchema = z.object({
  ghInstalled: z.boolean(),
  authenticated: z.boolean(),
  activeAccountLogin: z.string().optional(),
  owners: z.array(z.string()),
  suggestedRepoName: z.string(),
})

export const gitHubRepoAvailabilityResultSchema = z.object({
  available: z.boolean(),
  message: z.string(),
})

export const generateCommitMessageResultSchema = z.object({
  subject: z.string(),
  body: z.string(),
  usedFallback: z.boolean(),
  failureMessage: z.string().nullable(),
})

assertParity<z.output<typeof branchActionResultSchema>, BranchActionSuccess | BranchActionFailure>()
assertParity<z.output<typeof chatSyncResultSchema>, ChatSyncResult>()
assertParity<z.output<typeof diffCommitResultSchema>, DiffCommitResult>()
assertParity<z.output<typeof chatCreateBranchResultSchema>, ChatCreateBranchResult>()
assertParity<z.output<typeof chatMergePreviewResultSchema>, ChatMergePreviewResult>()
assertParity<z.output<typeof chatBranchListResultSchema>, ChatBranchListResult>()
assertParity<z.output<typeof gitHubPublishInfoSchema>, GitHubPublishInfo>()
assertParity<z.output<typeof gitHubRepoAvailabilityResultSchema>, GitHubRepoAvailabilityResult>()
assertParity<z.output<typeof branchActionResultSchema>, ChatCheckoutBranchResult | ChatMergeBranchResult>()
