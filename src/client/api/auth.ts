
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

export async function postAuthLogin(
  args: AuthLoginArgs,
  http: HttpPort = httpAdapter,
): Promise<boolean> {
  const body: Record<string, string> = { password: args.password }
  if (args.next) body.next = args.next
  const result = await http.postJson<AuthLoginResponse>("/auth/login", body)
  return result.ok
}

export async function postAuthLogout(http: HttpPort = httpAdapter): Promise<void> {
  await http.postJson<null>("/auth/logout", {})
}
