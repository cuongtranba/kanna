export type VerifyPtyAuthResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Checks the spawn-time auth preconditions for PTY mode.
 *
 * `ANTHROPIC_API_KEY` is always rejected: PTY mode exists to preserve
 * subscription billing via OAuth; an API key would silently flip the CLI
 * back to API billing.
 *
 * OAuth-pool token is the only supported auth path. Supply a non-empty
 * `oauthToken` arg; the driver injects it via `CLAUDE_CODE_OAUTH_TOKEN`.
 * No on-disk credentials file (`~/.claude/.credentials.json`) is consulted.
 * The local `claude /login` keychain path is not supported.
 */
export async function verifyPtyAuth(args: {
  env: NodeJS.ProcessEnv
  oauthToken?: string | null
}): Promise<VerifyPtyAuthResult> {
  if (typeof args.env.ANTHROPIC_API_KEY === "string" && args.env.ANTHROPIC_API_KEY.length > 0) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY is set in the environment. PTY mode uses Claude's subscription billing via OAuth keychain; remove the env var or use the SDK driver.",
    }
  }
  if (typeof args.oauthToken === "string" && args.oauthToken.length > 0) {
    return { ok: true }
  }
  return {
    ok: false,
    error: "No OAuth pool token supplied. PTY mode requires an OAuth-pool token configured in Kanna settings; the local `claude /login` keychain path is not supported.",
  }
}
