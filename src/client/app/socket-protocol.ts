/**
 * socket-protocol.ts — Kanna WebSocket protocol layer (skeleton).
 *
 * TODO (later burn-down chunk — Phase 1b/1c per plan):
 *   Move the correlation/subscription/queue/heartbeat logic out of socket.ts into this
 *   module. SocketBridge's onMessage handler will call into the dispatcher here.
 *
 * WHY this file exists now (Phase 0+1a):
 *   Establishes the boundary so later chunks have a clear import target. Importing from
 *   this file gives the compiler a type-safe seam even before the logic moves.
 *
 * CURRENT STATE:
 *   - src/client/app/socket.ts (KannaSocket class) continues to own the live connection.
 *   - This file is intentionally empty of logic until the relocation chunk lands.
 *   - Do NOT add correlation/subscription/queue/heartbeat logic here until that chunk —
 *     premature migration risks diverging from the existing tested code.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 * Component: c3-101 (socket-client)
 */

// Placeholder export so TypeScript accepts the module as non-empty and consumers
// can import from it to test the import path before the full migration.
export const SOCKET_PROTOCOL_TODO = "Phase 1b: relocate KannaSocket protocol layer here"
