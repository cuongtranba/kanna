
import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"
import { HTTP_ROUTES } from "../../shared/http-routes"

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

export type AuthStatusResult =
  | { kind: "ok"; status: Partial<AuthStatusResponse> }
  | { kind: "retry" }

export async function fetchAuthStatus(
  signal?: AbortSignal,
  http: HttpPort = httpAdapter,
): Promise<AuthStatusResult> {
  try {
    const result = await http.getJson<Partial<AuthStatusResponse> | null>(HTTP_ROUTES.authStatus.path, {
      cache: "no-store",
      signal,
    })
    if (!result.ok || result.data === null) return { kind: "retry" }
    return { kind: "ok", status: result.data }
  } catch {
    return { kind: "retry" }
  }
}

export async function postAuthLogin(
  args: AuthLoginArgs,
  http: HttpPort = httpAdapter,
): Promise<boolean> {
  const body: Record<string, string> = { password: args.password }
  if (args.next) body.next = args.next
  const result = await http.postJson<AuthLoginResponse>(HTTP_ROUTES.authLogin.path, body)
  return result.ok
}

export async function postAuthLogout(http: HttpPort = httpAdapter): Promise<void> {
  await http.postJson<null>(HTTP_ROUTES.authLogout.path, {})
}
