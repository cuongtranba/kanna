
import type { QueryFunctionContext } from "@tanstack/react-query"
import type { ChatSnapshot, ShareError } from "../../shared/session-share/types"
import type { HttpPort } from "../ports/httpPort"
import { httpAdapter } from "../adapters/http.adapter"

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
    `/api/share/${encodeURIComponent(token)}`,
    { signal: options.signal },
  )
  return result.data
}

export async function shareQueryFn(
  ctx: QueryFunctionContext<ReturnType<typeof shareQueryKeys.byToken>>,
): Promise<ShareApiResponse> {
  const [, token] = ctx.queryKey
  return fetchShareSnapshot(token, { signal: ctx.signal })
}

export function shareQueryOptions(token: string) {
  return {
    queryKey: shareQueryKeys.byToken(token),
    queryFn: shareQueryFn,
    staleTime: Infinity,
    retry: 0,
  } as const
}
