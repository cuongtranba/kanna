import { z } from "zod"
import {
  OAuthClientInformationFullSchema,
  OAuthMetadataSchema,
  OAuthTokensSchema,
  OpenIdProviderDiscoveryMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import type { McpOAuthState, McpServerInput, McpServerPatch, McpServerTestResult } from "./mcp-types"
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

const mcpServerStdioFieldsSchema = z.object({
  transport: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()),
  env: stringRecordSchema,
  cwd: z.string().optional(),
  name: z.string(),
  enabled: z.boolean().optional(),
})

const mcpServerNetworkFieldsSchema = z.object({
  transport: z.enum(["http", "sse", "ws"]),
  url: z.string(),
  headers: stringRecordSchema,
  oauth: mcpOAuthStateSchema.optional(),
  name: z.string(),
  enabled: z.boolean().optional(),
})

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

assertParity<z.output<typeof mcpServerTestResultSchema>, McpServerTestResult>()
assertParity<z.output<typeof mcpOAuthStateSchema>, McpOAuthState>()
assertParity<z.output<typeof mcpServerInputSchema>, McpServerInput>()
assertParity<z.output<typeof mcpServerPatchSchema>, McpServerPatch>()
