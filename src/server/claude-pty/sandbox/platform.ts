export function isSandboxSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}

export function isSandboxEnabled(args: {
  platform: NodeJS.Platform
  env: string | undefined
}): boolean {
  if (!isSandboxSupported(args.platform)) return false
  if (args.env === "off") return false
  return true
}
