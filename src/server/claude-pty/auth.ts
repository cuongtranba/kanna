export type VerifyPtyAuthResult =
  | { ok: true }
  | { ok: false; error: string }

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
