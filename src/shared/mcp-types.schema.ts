import { z } from "zod"
import {
  OAuthClientInformationFullSchema,
  OAuthMetadataSchema,
  OAuthTokensSchema,
  OpenIdProviderDiscoveryMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpOAuthState, McpServerConfig, McpServerInput, McpServerPatch, McpServerTestResult } from "./mcp-types"
import { assertParity } from "./type-parity"

const stringRecordSchema = z.record(z.string(), z.string())

export const mcpServerTransportSchema = z.enum(["stdio", "http", "sse", "ws"])

export const mcpServerTestResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("untested") }),
  z.object({ status: z.literal("pending"), startedAt: z.string() }),
  z.object({ status: z.literal("ok"), testedAt: z.string(), toolCount: z.number() }),
  z.object({ status: z.literal("error"), testedAt: z.string(), message: z.string() }),
])

const mcpOAuthFlowStateSchema = z.object({
  codeVerifier: z.string(),
  state: z.string(),
  issuer: z.string(),
  authorizationUrl: z.string(),
  metadata: z.union([OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema]),
})

export const mcpOAuthStateSchema = z.object({
  enabled: z.boolean(),
  status: z.enum(["unauthenticated", "authenticated", "error"]),
  errorMessage: z.string().optional(),
  issuer: z.string().optional(),
  metadata: z.union([OAuthMetadataSchema, OpenIdProviderDiscoveryMetadataSchema]).optional(),
  clientByIssuer: z.record(z.string(), OAuthClientInformationFullSchema).optional(),
  tokens: OAuthTokensSchema.optional(),
  obtainedAt: z.number().optional(),
  flow: mcpOAuthFlowStateSchema.optional(),
})

const mcpServerStdioShape = {
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()),
  env: stringRecordSchema,
  cwd: z.string().optional(),
}

const mcpServerNetworkShape = {
  transport: z.enum(["http", "sse", "ws"]),
  url: z.string(),
  headers: stringRecordSchema,
  oauth: mcpOAuthStateSchema.optional(),
}

const mcpServerInputIdentityShape = {
  name: z.string(),
  enabled: z.boolean().optional(),
}

const mcpServerStdioFieldsSchema = z.object({ ...mcpServerStdioShape, ...mcpServerInputIdentityShape })

const mcpServerNetworkFieldsSchema = z.object({ ...mcpServerNetworkShape, ...mcpServerInputIdentityShape })

export const mcpServerInputSchema = z.union([mcpServerStdioFieldsSchema, mcpServerNetworkFieldsSchema])

export const mcpServerPatchSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  transport: mcpServerTransportSchema.optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: stringRecordSchema.optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: stringRecordSchema.optional(),
  oauth: mcpOAuthStateSchema.optional(),
})

const mcpServerBaseShape = {
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastTest: mcpServerTestResultSchema,
}

export const mcpServerConfigSchema = z.union([
  z.object({ ...mcpServerBaseShape, ...mcpServerStdioShape }),
  z.object({ ...mcpServerBaseShape, ...mcpServerNetworkShape }),
])

export const mcpServerTestCommandResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  lastTest: mcpServerTestResultSchema,
})

export const mcpOAuthStartResultSchema = z.union([
  z.object({ ok: z.literal(false), error: z.string() }),
  z.object({ ok: z.literal(true), authorizationUrl: z.string() }),
  z.object({ ok: z.literal(true), alreadyAuthenticated: z.literal(true) }),
])

export const mcpOAuthCompleteResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), testResult: mcpServerTestResultSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

export type McpOAuthStartResult = z.output<typeof mcpOAuthStartResultSchema>
export type McpOAuthCompleteResult = z.output<typeof mcpOAuthCompleteResultSchema>

assertParity<z.output<typeof mcpServerTestResultSchema>, McpServerTestResult>()
assertParity<z.output<typeof mcpOAuthStateSchema>, McpOAuthState>()
assertParity<z.output<typeof mcpServerInputSchema>, McpServerInput>()
assertParity<z.output<typeof mcpServerPatchSchema>, McpServerPatch>()
assertParity<z.output<typeof mcpServerConfigSchema>, McpServerConfig>()
