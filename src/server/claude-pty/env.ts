/**
 * The environment a Claude CLI child is spawned with under the PTY driver.
 *
 * Extracted from `driver.ts`, which sits on its architecture-budget ceiling
 * and so has no room to grow. Pure: the base environment is an argument and
 * the result is a new object; nothing here reads `process.env`.
 *
 * The multi-root memory switch both drivers apply is NOT here — it is shared
 * with the SDK path, so it lives beside `buildClaudeEnv` in
 * `../claude-spawn-helpers.ts`.
 */

/**
 * PTY mode is OAuth-only: `ANTHROPIC_API_KEY` is stripped unconditionally so a
 * key in the parent environment cannot silently move billing off the
 * subscription. `HOME` is redirected so the child reads Kanna's own config.
 */
export function buildPtyEnv(args: {
  baseEnv: NodeJS.ProcessEnv
  homeDir: string
  oauthToken: string | null
}): NodeJS.ProcessEnv {
  const spawnEnv: NodeJS.ProcessEnv = { ...args.baseEnv }
  delete spawnEnv.ANTHROPIC_API_KEY
  spawnEnv.HOME = args.homeDir
  spawnEnv.DISABLE_AUTOUPDATER = "1"
  if (args.oauthToken && args.oauthToken.length > 0) {
    spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = args.oauthToken
  }
  return spawnEnv
}
