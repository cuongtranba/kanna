export function isBypassPermissionsAllowed(): boolean {
  if (process.getuid?.() !== 0) return true
  return process.env.IS_SANDBOX === "1" || Boolean(process.env.CLAUDE_CODE_BUBBLEWRAP)
}
