import { stat } from "node:fs/promises"
import path from "node:path"

export type VerifyPtyAuthResult =
  | { ok: true }
  | { ok: false; error: string }

export async function verifyPtyAuth(args: {
  homeDir: string
  env: NodeJS.ProcessEnv
}): Promise<VerifyPtyAuthResult> {
  if (typeof args.env.ANTHROPIC_API_KEY === "string" && args.env.ANTHROPIC_API_KEY.length > 0) {
    return {
      ok: false,
      error: "ANTHROPIC_API_KEY is set in the environment. PTY mode uses Claude's subscription billing via OAuth keychain; remove the env var or use the SDK driver.",
    }
  }
  const credentialsPath = path.join(args.homeDir, ".claude", ".credentials.json")
  try {
    await stat(credentialsPath)
  } catch {
    return {
      ok: false,
      error: `Claude credentials not found at ${credentialsPath}. Run \`claude /login\` once to authenticate, then try again.`,
    }
  }
  return { ok: true }
}
