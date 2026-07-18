/**
 * OAuth-pool error types shared between agent.ts and turn-spawning modules.
 * Kept in a standalone file to avoid circular imports.
 */

/**
 * Thrown by Claude spawn paths when the OAuth pool has tokens but every one
 * is currently unusable (rate-limited, errored, disabled, or reserved by
 * another chat). `startTurnForChat` catches this and persists `message` as a
 * `result` transcript entry instead of letting it surface as an ephemeral
 * commandError that gets wiped by the next chat snapshot tick.
 */
export class OAuthPoolUnavailableError extends Error {
  readonly kind = "oauth_pool_unavailable" as const
  constructor(message: string) {
    super(message)
    this.name = "OAuthPoolUnavailableError"
  }
}
