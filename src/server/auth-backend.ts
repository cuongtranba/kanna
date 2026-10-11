export const OWNER_EMAIL = "owner@kanna.local"
export const SESSION_COOKIE_NAME = "kanna_session"
export const CLIENT_IP_HEADER = "x-kanna-client-ip"
export const SIGN_IN_PATH = "/api/auth/sign-in/email"

export interface AuthSessionResult {
  authenticated: boolean
  setCookies: string[]
}

export interface AuthBackend {
  signIn(request: Request): Promise<Response>
  getSession(headers: Headers): Promise<AuthSessionResult>
  signOut(headers: Headers): Promise<string[]>
  dispose(): Promise<void>
}
