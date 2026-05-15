export interface PtyProcess {
  sendInput(data: string): Promise<void>
  resize(cols: number, rows: number): void
  exited: Promise<number>
  close(): void
}

export interface SpawnPtyProcessArgs {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  onOutput?: (chunk: string) => void
}

export async function spawnPtyProcess(opts: SpawnPtyProcessArgs): Promise<PtyProcess> {
  if (typeof Bun.Terminal !== "function") {
    throw new Error("Bun.Terminal not available — requires Bun 1.3.5+")
  }

  const cols = opts.cols ?? 120
  const rows = opts.rows ?? 40

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data: (_t, data) => {
      if (opts.onOutput) {
        const chunk = Buffer.from(data).toString("utf8")
        opts.onOutput(chunk)
      }
    },
  })

  const proc = Bun.spawn([opts.command, ...opts.args], {
    cwd: opts.cwd,
    env: opts.env,
    terminal,
  })

  return {
    async sendInput(data) { terminal.write(data) },
    resize(newCols, newRows) { terminal.resize(newCols, newRows) },
    exited: proc.exited,
    close() {
      try { terminal.close() } catch { /* swallow */ }
      try { proc.kill() } catch { /* swallow */ }
    },
  }
}
