const SANDBOX_EXEC = "/usr/bin/sandbox-exec"

export interface WrapArgs {
  platform: NodeJS.Platform
  enabled: boolean
  profilePath: string
  command: string
  args: string[]
}

export interface WrapResult {
  command: string
  args: string[]
}

export function wrapWithSandbox(opts: WrapArgs): WrapResult {
  if (opts.platform !== "darwin" || !opts.enabled) {
    return { command: opts.command, args: opts.args }
  }
  return {
    command: SANDBOX_EXEC,
    args: ["-f", opts.profilePath, opts.command, ...opts.args],
  }
}
