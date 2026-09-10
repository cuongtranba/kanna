
export function buildPtyEnv(args: {
  baseEnv: NodeJS.ProcessEnv
  homeDir: string
  oauthToken: string | null
  baseUrl?: string | null
}): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = { ...args.baseEnv }
  delete spawnEnv.ANTHROPIC_API_KEY
  spawnEnv.HOME = args.homeDir
  spawnEnv.DISABLE_AUTOUPDATER = "1"
  if (args.oauthToken && args.oauthToken.length > 0) {
    spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = args.oauthToken
  }
  if (args.baseUrl && args.baseUrl.length > 0) {
    spawnEnv.ANTHROPIC_BASE_URL = args.baseUrl
  }
  return spawnEnv
}
