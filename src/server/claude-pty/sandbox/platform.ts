import { detectBwrap } from "./detect"

export function isSandboxSupported(platform: NodeJS.Platform): boolean {
  return platform === "darwin"
}

export async function isSandboxEnabledAsync(args: {
  platform: NodeJS.Platform
  env: string | undefined
}): Promise<boolean> {
  if (args.env === "off") return false
  if (args.platform === "darwin") return true
  if (args.platform === "linux") return await detectBwrap()
  return false
}

export function isSandboxEnabled(args: {
  platform: NodeJS.Platform
  env: string | undefined
}): boolean {
  if (!isSandboxSupported(args.platform)) return false
  if (args.env === "off") return false
  return true
}
