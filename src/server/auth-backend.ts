import { AUTH_BASE_PATH } from "./remote-mcp/oauth-paths"

export const OWNER_EMAIL = "owner@kanna.local"
export const SESSION_COOKIE_NAME = "kanna_session"
export const CLIENT_IP_HEADER = "x-kanna-client-ip"
export const SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/email`

export interface AuthSessionResult {
  authenticated: boolean
  setCookies: string[]
}

export interface RemoteMcpAuthConfig {
  publicOrigin: string
}

export interface RemoteMcpPrincipal {
  clientId: string
  scopes: string[]
  expiresAt: number | null
  via: "oauth" | "password"
}

export interface OAuthClientDescription {
  name: string
  redirectUris: string[]
}

export type OAuthConsentOutcome = { redirectTo: string } | { error: string }

export interface DescribeOAuthClientArgs {
  headers?: Headers
  clientId: string
  oauthQuery?: string
}

export interface AuthBackend {
  signIn(request: Request): Promise<Response>
  getSession(headers: Headers): Promise<AuthSessionResult>
  signOut(headers: Headers): Promise<string[]>
  dispose(): Promise<void>
  configureRemoteMcp(config: RemoteMcpAuthConfig): void
  remoteMcpResource(): string | null
  handleOAuth(request: Request): Promise<Response | null>
  consentForOAuth(headers: Headers, oauthQuery: string, accept: boolean): Promise<OAuthConsentOutcome>
  describeOAuthClient(args: DescribeOAuthClientArgs): Promise<OAuthClientDescription | null>
  verifyRemoteMcpToken(token: string): Promise<RemoteMcpPrincipal | null>
}
