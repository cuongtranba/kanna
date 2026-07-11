import type { Subprocess } from "bun"

interface SpawnWithTerminalOpts {
  cwd?: string
  env?: Record<string, string | undefined>
  terminal?: Bun.Terminal
}

export function hasBunTerminal(): boolean {
  return typeof Bun.Terminal === "function"
}

export function createBunTerminal(opts: Bun.TerminalOptions): Bun.Terminal {
  return new Bun.Terminal(opts)
}

export function spawnTerminalProcess(cmd: string[], opts: SpawnWithTerminalOpts): Subprocess {
  return Bun.spawn(cmd, opts)
}
