/**
 * queryClient.ts — React Query QueryClient singleton.
 *
 * Owns the browser-side server-cache surface (HTTP API calls).
 * - Zustand actions call queryClient.fetchQuery / ensureQueryData / setQueryData imperatively.
 * - WS dispatcher calls queryClient.setQueryData / invalidateQueries to sync server-push updates.
 * - Components use useQuery / useMutation (from @tanstack/react-query) to read from this cache.
 *
 * This is NOT a Zustand store. The singleton is stable across the app lifetime (single SPA session).
 * SSR is not a concern — Kanna is a local-only SPA — so there is no server-side client factory.
 *
 * Architecture: see .c3/adr/adr-20260715-client-state-effect-architecture.md
 * Component:    c3-102 (state-stores, extended to include server-cache surface)
 */

import { QueryClient } from "@tanstack/react-query"

/**
 * Shared QueryClient instance.
 * Imported directly by:
 *   - src/client/app/App.tsx (wrapped in QueryClientProvider)
 *   - Zustand action files that need imperative cache access outside React
 *   - src/client/app/SocketBridge.tsx (WS dispatcher: setQueryData / invalidateQueries)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Kanna is a local SPA backed by a local server — data is always fresh via WS push.
      // A non-zero staleTime avoids redundant refetches when components mount.
      staleTime: 30_000,
      // Retry once on transient errors; local server failures are usually permanent until restart.
      retry: 1,
    },
  },
})
