export type VerifyPtyAuthResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Checks the spawn-time auth preconditions for PTY mode.
 *
 * PTY mode is OAuth-only by construction: it NEVER uses an API key. The
 * OAuth-pool token is the sole supported auth path — supply a non-empty
 * `oauthToken` arg and the driver injects it via `CLAUDE_CODE_OAUTH_TOKEN`.
 * No on-disk credentials file (`~/.claude/.credentials.json`) and no local
 * `claude /login` keychain path is consulted.
 *
 * `ANTHROPIC_API_KEY` in the parent environment is NOT a failure: the
 * driver's `buildPtyEnv` unconditionally deletes it from the spawned child
 * env, so the CLI can never fall back to API billing. Rejecting the spawn
 * outright (the old behaviour) only forced operators to manually unset a
 * harmless env var; the strip already guarantees subscription billing.
 */
export async function verifyPtyAuth(args: {
  env: NodeJS.ProcessEnv
  oauthToken?: string | null
}): Promise<VerifyPtyAuthResult> {
  void args.env
  if (typeof args.oauthToken === "string" && args.oauthToken.length > 0) {
    return { ok: true }
  }
  return {
    ok: false,
    error: "No OAuth pool token supplied. PTY mode is OAuth-only and requires an OAuth-pool token configured in Kanna settings; API keys and the local `claude /login` keychain path are not used.",
  }
}
