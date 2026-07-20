/**
 * api/auth.ts — React Query queryFn wrappers for authentication endpoints.
 *
 * Covers:
 *   GET  /auth/status  — check if password auth is enabled + current session state
 *   POST /auth/login   — submit password, get session cookie
 *   POST /auth/logout  — clear session cookie
 *
 * Call sites: App.tsx, useKannaState.ts, SettingsPage.tsx.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"

export interface AuthStatusResponse {
  enabled: boolean
  authenticated: boolean
}

export interface AuthLoginArgs {
  password: string
  next?: string
}

export interface AuthLoginResponse {
  ok: boolean
}

/**
 * Fetch the current auth status (enabled / authenticated).
 * Callers should pass `signal` for cancellation.
 */
export async function fetchAuthStatus(
  signal?: AbortSignal,
  http: HttpPort = httpAdapter,
): Promise<Partial<AuthStatusResponse>> {
  const result = await http.getJson<Partial<AuthStatusResponse>>("/auth/status", {
    cache: "no-store",
    signal,
  })
  if (!result.ok) return {}
  return result.data
}

/**
 * Submit a login password. Returns true on success, false on 401/403.
 */
export async function postAuthLogin(
  args: AuthLoginArgs,
  http: HttpPort = httpAdapter,
): Promise<boolean> {
  const body: Record<string, string> = { password: args.password }
  if (args.next) body.next = args.next
  const result = await http.postJson<AuthLoginResponse>("/auth/login", body)
  return result.ok
}

/**
 * Sign out the current session.
 */
export async function postAuthLogout(http: HttpPort = httpAdapter): Promise<void> {
  await http.postJson<null>("/auth/logout", {})
}
