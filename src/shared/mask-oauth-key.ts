const PREFIX = 12
const SUFFIX = 4
const MIN_LENGTH = PREFIX + SUFFIX + 4

export function maskOauthKey(token: string): string {
  if (!token || token.length < MIN_LENGTH) return "***"
  return `${token.slice(0, PREFIX)}...${token.slice(-SUFFIX)}`
}
