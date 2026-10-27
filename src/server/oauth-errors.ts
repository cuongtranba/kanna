
export class OAuthPoolUnavailableError extends Error {
  readonly kind = "oauth_pool_unavailable" as const
  constructor(message: string) {
    super(message)
    this.name = "OAuthPoolUnavailableError"
  }
}

export interface PickedOAuthToken {
  id: string
  token: string
  label: string
  baseUrl?: string
}

export interface OAuthTokenPicker {
  pickActive(chatId: string): PickedOAuthToken | null | undefined
  hasAnyToken(): boolean
  markUsed(tokenId: string): void
}

export function pickOAuthTokenOrRefuse(
  pool: OAuthTokenPicker | null,
  chatId: string,
  refusal: () => string,
): PickedOAuthToken | null {
  if (!pool) return null
  const picked = pool.pickActive(chatId) ?? null
  if (!picked) {
    if (pool.hasAnyToken()) throw new OAuthPoolUnavailableError(refusal())
    return null
  }
  pool.markUsed(picked.id)
  return picked
}
