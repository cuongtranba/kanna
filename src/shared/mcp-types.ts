// MCP (Model Context Protocol) server types.
// Extracted from types.ts to keep the barrel lean.
// All external consumers importing from "../shared/types" continue to work unchanged.

import type {
  OAuthTokens,
  OAuthClientInformationFull,
  AuthorizationServerMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js"

export type McpServerTransport = "stdio" | "http" | "sse" | "ws"

export type McpServerTestResult =
  | { status: "untested" }
  | { status: "pending"; startedAt: string }
  | { status: "ok"; testedAt: string; toolCount: number }
  | { status: "error"; testedAt: string; message: string }

export interface McpOAuthFlowState {
  codeVerifier: string
  state: string
  issuer: string
  authorizationUrl: string
  // AS metadata cached between start and complete (avoids re-discovery)
  metadata: AuthorizationServerMetadata
}

export interface McpOAuthState {
  enabled: boolean
  status: "unauthenticated" | "authenticated" | "error"
  errorMessage?: string
  // resolved AS issuer (set on complete; used by refresh without re-discovery)
  issuer?: string
  // cached AS metadata (token_endpoint, etc.) persisted at complete so refresh
  // uses it directly instead of re-discovering from issuer (which may be a
  // non-resolvable resource URL, e.g. claude.ai design MCP)
  metadata?: AuthorizationServerMetadata
  // DCR result keyed by AS issuer (SEP-2352)
  clientByIssuer?: Record<string, OAuthClientInformationFull>
  tokens?: OAuthTokens
  obtainedAt?: number
  // present only mid-flow; cleared on complete/cancel
  flow?: McpOAuthFlowState
}

interface McpServerBase {
  id: string
  name: string
  enabled: boolean
  createdAt: string
  updatedAt: string
  lastTest: McpServerTestResult
}

export interface McpServerStdioFields {
  transport: "stdio"
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

export interface McpServerNetworkFields {
  transport: "http" | "sse" | "ws"
  url: string
  headers: Record<string, string>
  oauth?: McpOAuthState
}

export type McpServerConfig =
  | (McpServerBase & McpServerStdioFields)
  | (McpServerBase & McpServerNetworkFields)

export type McpServerInput =
  | (McpServerStdioFields & { name: string; enabled?: boolean })
  | (McpServerNetworkFields & { name: string; enabled?: boolean })

export type McpServerPatch = Partial<{
  name: string
  enabled: boolean
  transport: McpServerTransport
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string | undefined
  url: string
  headers: Record<string, string>
  oauth: McpOAuthState
}>

export interface McpValidationError {
  code:
    | "INVALID_NAME"
    | "DUPLICATE_NAME"
    | "RESERVED_NAME"
    | "INVALID_TRANSPORT"
    | "MISSING_COMMAND"
    | "INVALID_URL"
    | "INVALID_HEADER_KEY"
    | "INVALID_ENV_KEY"
    | "NOT_FOUND"
    | "INVALID_OAUTH_TRANSPORT"
  field?: string
  message: string
}
