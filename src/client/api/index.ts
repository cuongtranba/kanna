/**
 * src/client/api/index.ts — API layer barrel.
 *
 * Re-exports all queryFn wrappers for React Query. These functions sit
 * between components/stores and the HTTP transport (HttpPort). They are
 * the only place in src/client/** that knows about specific API routes.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export * from "./auth"
export * from "./share"
export * from "./projects"
export * from "./files"
