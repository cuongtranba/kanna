import { Terminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"

export interface PtyProcess {
  sendInput(data: string): Promise<void>
  resize(cols: number, rows: number): void
  headless: Terminal
  serializer: SerializeAddon
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

  const headless = new Terminal({ cols, rows, scrollback: 4000, allowProposedApi: true })
  const serializer = new SerializeAddon()
  headless.loadAddon(serializer)

  const terminal = new Bun.Terminal({
    cols,
    rows,
    name: "xterm-256color",
    data: (_t, data) => {
      const chunk = Buffer.from(data).toString("utf8")
      headless.write(chunk)
      opts.onOutput?.(chunk)
    },
  })

  const proc = Bun.spawn([opts.command, ...opts.args], {
    cwd: opts.cwd,
    env: opts.env,
    terminal,
  })

  return {
    async sendInput(data) {
      terminal.write(data)
    },
    resize(newCols, newRows) {
      terminal.resize(newCols, newRows)
      headless.resize(newCols, newRows)
    },
    headless,
    serializer,
    exited: proc.exited,
    close() {
      try {
        terminal.close()
      } catch {
        /* swallow */
      }
      try {
        headless.dispose()
      } catch {
        /* swallow */
      }
      try {
        proc.kill()
      } catch {
        /* swallow */
      }
    },
  }
}
