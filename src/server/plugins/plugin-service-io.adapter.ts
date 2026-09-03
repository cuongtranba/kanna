/**
 * The only file allowed to touch process/socket/filesystem primitives for the
 * plugin server runtime (side-effect seal: `.adapter.ts`). `plugin-service.ts`
 * holds the domain state machine (install/enable/start/call/stop) and drives
 * these functions; nothing here decides plugin lifecycle policy.
 */
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { errorMessage } from "../../shared/errors"
import { KANNA_PLUGIN_MANIFEST_FILENAME } from "../../shared/plugins/manifest"
import { pluginSocketPathFits } from "../../shared/plugins/paths"
import {
  encodePluginLine,
  parsePluginChildMessage,
  type PluginChildMessage,
  type PluginHostCallMessage,
} from "./plugin-rpc-protocol"

export async function readPluginManifestText(sourceDir: string): Promise<string> {
  return Bun.file(join(sourceDir, KANNA_PLUGIN_MANIFEST_FILENAME)).text()
}

export async function writePluginServerBundle(bundlePath: string, code: string): Promise<void> {
  await Bun.write(bundlePath, code)
}

/** Compiled browser bundle, written beside `server.js` so `GET /api/plugins/:id/client.js` can serve it. */
export async function writePluginClientBundle(bundlePath: string, code: string): Promise<void> {
  await Bun.write(bundlePath, code)
}

/** Null when the plugin was never installed on this machine, or its build dir was removed. */
export async function readPluginClientBundle(bundlePath: string): Promise<string | null> {
  const file = Bun.file(bundlePath)
  return (await file.exists()) ? file.text() : null
}

/**
 * MEASURED (`../../shared/plugins/paths.ts`): a build-dir-rooted socket path
 * overflows macOS's 104-byte `sun_path` cap for a long plugin id, so the
 * socket lives in the system temp dir under a short RANDOM name — never
 * derived from the plugin id, which is unbounded up to 64 bytes on its own.
 */
export function allocatePluginSocketPath(): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = join(tmpdir(), `kanna-plugin-${randomUUID().replace(/-/g, "").slice(0, 12)}.sock`)
    if (pluginSocketPathFits(candidate)) return candidate
  }
  throw new Error("plugin-service: could not allocate a plugin socket path inside the sun_path byte cap")
}

export interface PluginHostConnection {
  send(message: PluginHostCallMessage): void
  close(): void
}

export interface PluginSocketListener {
  /**
   * Resolves once the child both connects AND sends its `"ready"` message —
   * a bare accept does not mean `contribute()` has finished registering RPC
   * handlers yet.
   */
  readonly ready: Promise<PluginHostConnection>
  stop(): void
}

/**
 * Listens BEFORE the child spawns (`plugin-service.ts`'s `start`), so the
 * child never races a connection attempt against a not-yet-bound socket.
 */
export function listenForPluginChild(
  socketPath: string,
  onMessage: (message: PluginChildMessage) => void,
  onDisconnect: () => void,
): PluginSocketListener {
  let settleReady: ((connection: PluginHostConnection) => void) | null = null
  let rejectReady: ((error: Error) => void) | null = null
  const ready = new Promise<PluginHostConnection>((resolve, reject) => {
    settleReady = resolve
    rejectReady = reject
  })

  const server = createServer((socket: Socket) => {
    const connection: PluginHostConnection = {
      send(message) {
        socket.write(encodePluginLine(message))
      },
      close() {
        socket.end()
      },
    }
    const lines = createInterface({ input: socket })
    void (async () => {
      for await (const line of lines) {
        const message = parsePluginChildMessage(line)
        if (!message) continue
        if (message.type === "ready") {
          settleReady?.(connection)
          settleReady = null
          continue
        }
        onMessage(message)
      }
    })()
    socket.on("close", onDisconnect)
    socket.on("error", onDisconnect)
  })

  server.on("error", (error) => {
    rejectReady?.(error instanceof Error ? error : new Error(errorMessage(error)))
  })
  server.listen(socketPath)

  return {
    ready,
    stop() {
      server.close()
    },
  }
}

export interface PluginChildLogEntry {
  readonly stream: "out" | "err"
  readonly text: string
}

export interface SpawnedPluginChild {
  readonly exited: Promise<number>
  kill(): void
}

/** The subprocess entry script, resolved relative to this adapter's own directory. */
const CHILD_ENTRY_PATH = join(import.meta.dir, "plugin-child-entry.adapter.ts")

function pipeLines(
  stream: NodeJS.ReadableStream | null,
  streamName: "out" | "err",
  onLog: (entry: PluginChildLogEntry) => void,
): void {
  if (!stream) return
  createInterface({ input: stream }).on("line", (text) => onLog({ stream: streamName, text }))
}

/**
 * Spawns the compiled plugin's own OS process. Runs the SAME `bun` binary
 * currently executing the Kanna daemon (`process.execPath`) rather than a
 * `"bun"` lookup on `$PATH`, so the child is never accidentally a different
 * installed Bun version. stdout/stderr are piped line-by-line into `onLog`
 * (destined for `createPluginLogRing()` on the domain side) — the RPC
 * protocol itself rides the Unix socket, never stdio, so a plugin's own
 * `console.log` can never corrupt an RPC frame.
 */
export function spawnPluginChild(args: {
  readonly bundlePath: string
  readonly socketPath: string
  readonly onLog: (entry: PluginChildLogEntry) => void
}): SpawnedPluginChild {
  const child = spawn(process.execPath, [CHILD_ENTRY_PATH, args.bundlePath, args.socketPath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  })

  pipeLines(child.stdout, "out", args.onLog)
  pipeLines(child.stderr, "err", args.onLog)

  const exited = new Promise<number>((resolve) => {
    child.once("exit", (code) => resolve(code ?? 1))
    child.once("error", () => resolve(1))
  })

  return {
    exited,
    kill() {
      child.kill("SIGKILL")
    },
  }
}
