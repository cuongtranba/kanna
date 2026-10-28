
import type { QueryFunctionContext } from "@tanstack/react-query"
import type { ChatSnapshot, ShareError } from "../../shared/session-share/types"
import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"
import { buildRoutePath, HTTP_ROUTES } from "../../shared/http-routes"

export interface ShareApiOk {
  ok: true
  snapshot: ChatSnapshot
}

export interface ShareApiErr {
  ok: false
  error: ShareError
}

export type ShareApiResponse = ShareApiOk | ShareApiErr

export const shareQueryKeys = {
  all: ["share"] as const,
  byToken: (token: string) => ["share", token] as const,
}

export async function fetchShareSnapshot(
  token: string,
  options: { signal?: AbortSignal; http?: HttpPort } = {},
): Promise<ShareApiResponse> {
  const http = options.http ?? httpAdapter
  const result = await http.getJson<ShareApiResponse>(
    buildRoutePath(HTTP_ROUTES.shareSnapshot.path, { token }),
    { signal: options.signal },
  )
  return result.data
}

export function shareQueryOptions(token: string, http?: HttpPort) {
  return {
    queryKey: shareQueryKeys.byToken(token),
    queryFn: (ctx: QueryFunctionContext<ReturnType<typeof shareQueryKeys.byToken>>): Promise<ShareApiResponse> =>
      fetchShareSnapshot(token, { signal: ctx.signal, http }),
    staleTime: Infinity,
    retry: 0,
  } as const
}
