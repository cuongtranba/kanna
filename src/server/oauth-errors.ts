
export class OAuthPoolUnavailableError extends Error {
  readonly kind = "oauth_pool_unavailable" as const
  constructor(message: string) {
    super(message)
    this.name = "OAuthPoolUnavailableError"
  }
}
