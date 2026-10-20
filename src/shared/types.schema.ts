import { z } from "zod"
import type {
  ChatAttachment,
  GithubRelease,
  LlmProviderSnapshot,
  LlmProviderValidationResult,
  PushSubscribeRequestPayload,
  UpdateInstallResult,
  UpdateSnapshot,
} from "./types"
import { attachmentKindSchema, llmProviderKindSchema } from "./core-types.schema"
import { jsonValueSchema } from "./genui/json-schema"
import { assertParity } from "./type-parity"

export const chatAttachmentSchema = z.object({
  id: z.string(),
  kind: attachmentKindSchema,
  displayName: z.string(),
  absolutePath: z.string(),
  relativePath: z.string(),
  contentUrl: z.string(),
  mimeType: z.string(),
  size: z.number(),
})

export const pushSubscribeRequestPayloadSchema = z.object({
  endpoint: z.string(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
})

export const llmProviderSnapshotSchema = z.object({
  provider: llmProviderKindSchema,
  apiKey: z.string(),
  model: z.string(),
  baseUrl: z.string(),
  resolvedBaseUrl: z.string(),
  enabled: z.boolean(),
  warning: z.string().nullable(),
  filePathDisplay: z.string(),
})

export const llmProviderValidationResultSchema = z.object({
  ok: z.boolean(),
  error: jsonValueSchema.nullable(),
})

export const oauthTokenTestResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
})

export const updateSnapshotSchema = z.object({
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  status: z.enum(["idle", "checking", "available", "up_to_date", "updating", "restart_pending", "error"]),
  updateAvailable: z.boolean(),
  lastCheckedAt: z.number().nullable(),
  error: z.string().nullable(),
  installAction: z.enum(["restart", "reload"]),
  reloadRequestedAt: z.number().nullable(),
})

export const updateInstallResultSchema = z.object({
  ok: z.boolean(),
  action: z.enum(["restart", "reload"]),
  errorCode: z.enum(["version_not_live_yet", "install_failed", "command_missing"]).nullable(),
  userTitle: z.string().nullable(),
  userMessage: z.string().nullable(),
})

export const githubReleaseSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  tag_name: z.string(),
  html_url: z.string(),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
  prerelease: z.boolean(),
  draft: z.boolean(),
})

assertParity<z.output<typeof chatAttachmentSchema>, ChatAttachment>()
assertParity<z.output<typeof pushSubscribeRequestPayloadSchema>, PushSubscribeRequestPayload>()
assertParity<z.output<typeof llmProviderSnapshotSchema>, LlmProviderSnapshot>()
assertParity<z.output<typeof llmProviderValidationResultSchema>, LlmProviderValidationResult>()
assertParity<z.output<typeof updateSnapshotSchema>, UpdateSnapshot>()
assertParity<z.output<typeof updateInstallResultSchema>, UpdateInstallResult>()
assertParity<z.output<typeof githubReleaseSchema>, GithubRelease>()
