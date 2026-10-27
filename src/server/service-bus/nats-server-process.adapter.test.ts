import { afterEach, describe, expect, test } from "vite-plus/test"
import { spawn as nodeSpawn } from "node:child_process"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SERVICE_BUS_DEFAULTS } from "../../shared/service-bus/jetstream-config"
import {
  READY_LINE,
  RESTART_BACKOFF_INITIAL_MS,
  STOP_GRACE_MS,
  createNatsServerProcess,
  reapStaleNatsServer,
  type NatsChild,
  type NatsProcessEvent,
} from "./nats-server-process.adapter"
import { natsRuntimePaths } from "./nats-server-release"

let dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kanna-nats-proc-"))
  dirs.push(dir)
  return dir
}

class FakeChild implements NatsChild {
  pid = 4242
  signals: string[] = []
  private output: ((chunk: string) => void)[] = []
  private exits: ((code: number | null) => void)[] = []
  kill(signal: "SIGTERM" | "SIGKILL"): void {
    this.signals.push(signal)
    if (signal === "SIGKILL" || this.exitOnTerm) this.exit(null)
  }
  exitOnTerm = true
  onOutput(listener: (chunk: string) => void): void {
    this.output.push(listener)
  }
  onExit(listener: (code: number | null) => void): void {
    this.exits.push(listener)
  }
  say(text: string): void {
    for (const listener of this.output) listener(text)
  }
  exit(code: number | null): void {
    for (const listener of this.exits) listener(code)
  }
}

function harness() {
  const children: FakeChild[] = []
  const timers: { run: () => void; delayMs: number; cancelled: boolean }[] = []
  const spawnArgs: string[][] = []
  return {
    children,
    timers,
    spawnArgs,
    spawn: (_command: string, args: string[]): NatsChild => {
      spawnArgs.push(args)
      const child = new FakeChild()
      children.push(child)
      return child
    },
    schedule: (run: () => void, delayMs: number) => {
      const timer = { run, delayMs, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  }
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 3000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition was not reached")
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
}

describe("createNatsServerProcess", () => {
  async function started(portSetting: "auto" | number = "auto") {
    const dataDir = await tempDataDir()
    const fake = harness()
    const events: NatsProcessEvent[] = []
    const server = createNatsServerProcess({
      binaryPath: "/bin/nats-server",
      dataDir,
      settings: { ...SERVICE_BUS_DEFAULTS.embedded, port: portSetting },
      token: "private-token-value",
      spawn: fake.spawn,
      pickPort: async () => 50123,
      schedule: fake.schedule,
      now: () => 0,
    })
    server.subscribe((event) => events.push(event))
    const starting = server.start()
    await until(() => fake.children.length === 1)
    return { dataDir, fake, events, server, starting }
  }

  test("writes a private config with the token, spawns from it, and resolves on the ready line", async () => {
    const { dataDir, fake, server, starting } = await started()
    fake.children[0]?.say(`[1] [INF] ${READY_LINE}\n`)

    expect(await starting).toEqual({ port: 50123 })
    const paths = natsRuntimePaths(dataDir)
    expect(fake.spawnArgs[0]).toEqual(["-c", paths.config])
    expect(await readFile(paths.config, "utf8")).toContain('token: "private-token-value"')
    expect((await stat(paths.config)).mode & 0o077).toBe(0)
    expect(server.status()).toMatchObject({ state: "ready", port: 50123 })
    expect(JSON.stringify(fake.spawnArgs)).not.toContain("private-token-value")
  })

  test("uses a fixed port without picking one", async () => {
    const { fake, starting } = await started(4333)
    fake.children[0]?.say(READY_LINE)
    expect(await starting).toEqual({ port: 4333 })
  })

  test("rejects start when the server exits before it is ready, naming its last output", async () => {
    const { fake, starting, server } = await started()
    fake.children[0]?.say("[ERR] address already in use\n")
    fake.children[0]?.exit(1)

    await expect(starting).rejects.toThrow("address already in use")
    expect(server.status().state).toBe("stopped")
  })

  test("rejects start and kills the child when it never becomes ready", async () => {
    const { fake, starting } = await started()
    const timeout = fake.timers[0]
    timeout?.run()

    await expect(starting).rejects.toThrow("did not become ready")
    expect(fake.children[0]?.signals).toContain("SIGKILL")
  })

  test("restarts on the same port after an unexpected exit, backing off and counting", async () => {
    const { fake, events, server, starting } = await started()
    fake.children[0]?.say(READY_LINE)
    await starting

    fake.children[0]?.exit(2)
    expect(server.status()).toMatchObject({ state: "restarting", restarts: 1 })
    expect(events.at(-1)).toEqual({ kind: "exited", code: 2, retryInMs: RESTART_BACKOFF_INITIAL_MS })

    fake.timers.at(-1)?.run()
    await until(() => fake.children.length === 2)
    fake.children[1]?.say(READY_LINE)
    await until(() => server.status().state === "ready")

    expect(server.status()).toMatchObject({ state: "ready", port: 50123 })
    expect(events.at(-1)).toEqual({ kind: "ready", port: 50123, restart: true })
  })

  test("doubles the delay when the restart itself fails", async () => {
    const { fake, events, starting } = await started()
    fake.children[0]?.say(READY_LINE)
    await starting
    fake.children[0]?.exit(1)

    fake.timers.at(-1)?.run()
    await until(() => fake.children.length === 2)
    fake.children[1]?.exit(1)
    await until(() => events.at(-1)?.kind === "failed")

    expect(events.at(-1)).toMatchObject({ kind: "failed", retryInMs: RESTART_BACKOFF_INITIAL_MS * 2 })
  })

  test("stop sends SIGTERM, waits for the exit and does not restart", async () => {
    const { fake, server, starting } = await started()
    fake.children[0]?.say(READY_LINE)
    await starting

    await server.stop()

    expect(fake.children[0]?.signals).toEqual(["SIGTERM"])
    expect(server.status().state).toBe("stopped")
    expect(fake.timers.filter((timer) => !timer.cancelled && timer.delayMs === RESTART_BACKOFF_INITIAL_MS)).toEqual([])
  })

  test("stop escalates to SIGKILL when the server ignores SIGTERM", async () => {
    const { fake, server, starting } = await started()
    const child = fake.children[0]
    if (child === undefined) throw new Error("no child")
    child.exitOnTerm = false
    child.say(READY_LINE)
    await starting

    const stopping = server.stop()
    await until(() => fake.timers.some((timer) => timer.delayMs === STOP_GRACE_MS))
    fake.timers.find((timer) => timer.delayMs === STOP_GRACE_MS)?.run()
    await stopping

    expect(child.signals).toEqual(["SIGTERM", "SIGKILL"])
  })
})

describe("reapStaleNatsServer", () => {
  test("leaves alone a process that is not a nats-server even if the pid file names it", async () => {
    const dataDir = await tempDataDir()
    const bystander = nodeSpawn("sleep", ["30"], { stdio: "ignore" })
    try {
      const pidFile = join(dataDir, "nats-server.pid")
      await writeFile(pidFile, String(bystander.pid))
      expect(await reapStaleNatsServer(pidFile)).toBe(false)
      expect(bystander.exitCode).toBeNull()
    } finally {
      bystander.kill("SIGKILL")
    }
  })

  test("does nothing without a pid file", async () => {
    const dataDir = await tempDataDir()
    expect(await reapStaleNatsServer(natsRuntimePaths(dataDir).pid)).toBe(false)
  })
})
