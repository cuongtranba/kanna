/**
 * api/share.ts — React Query queryFn wrapper for the share-view endpoint.
 *
 * Covers:
 *   GET /api/share/:token — fetch a shared chat snapshot by token
 *
 * The current call site (SharePage.tsx) will migrate to useQuery(shareQueryOptions(token))
 * in a later burn-down chunk.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

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

/**
 * Fetch a shared chat snapshot by token.
 * Returns the parsed API response (ok: true|false) without throwing on
 * application-level errors (not_found, revoked, etc.) — the UI handles those.
 * Throws only on network failures.
 */
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

/**
 * React Query queryFn for a shared chat snapshot.
 * Usage: useQuery(shareQueryOptions(token))
 */
export async function shareQueryFn(
  ctx: QueryFunctionContext<ReturnType<typeof shareQueryKeys.byToken>>,
): Promise<ShareApiResponse> {
  const [, token] = ctx.queryKey
  return fetchShareSnapshot(token, { signal: ctx.signal })
}

/**
 * Convenience helper: compose a full queryOptions object.
 */
export function shareQueryOptions(token: string) {
  return {
    queryKey: shareQueryKeys.byToken(token),
    queryFn: shareQueryFn,
    // Share links are immutable once rendered — no stale refetch needed.
    staleTime: Infinity,
    retry: 0,
  } as const
}
