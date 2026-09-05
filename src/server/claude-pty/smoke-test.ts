import path from "node:path"
import {
  fileExists,
  makeTempCwd,
  mkdirRecursive,
  readTextFile,
  rmDirRecursive,
  writeFile0600,
} from "./smoke-test-io.adapter"
import { isRecord } from "../../shared/errors"
import { OutputRing } from "./output-ring"
import { spawnPtyProcess as defaultSpawnPtyProcess } from "./pty-process.adapter"
import { waitForTuiReadyWithTrustDismiss, sendUserPrompt, sendExitCommand } from "./tui-control"
import { startTranscriptStream, waitForResultEntry } from "./tui-source.adapter"
import { computeProjectDir } from "./jsonl-path.adapter"
import { log } from "../../shared/log"

export type SmokeTestProbeFn = () => Promise<"pass" | "fail">

export interface SmokeTestCacheEntry {
  result: "pass" | "fail"
  ts: number
}

export interface SmokeTestCache {
  get(key: string): Promise<SmokeTestCacheEntry | null>
  set(key: string, entry: SmokeTestCacheEntry): Promise<void>
  invalidate(): Promise<void>
}

export interface SmokeTestGateArgs {
  probe: SmokeTestProbeFn
  cache: SmokeTestCache
  ttlMs: number
  now: () => number
}

export interface CanSpawnArgs {
  binarySha256: string
  model: string
}

export interface SmokeTestGate {
  canSpawn(args: CanSpawnArgs): Promise<{ ok: true } | { ok: false; reason: string }>
}

export function createSmokeTestGate(args: SmokeTestGateArgs): SmokeTestGate {
  const { probe, cache, ttlMs, now } = args
  const inFlight = new Map<string, Promise<{ ok: true } | { ok: false; reason: string }>>()
  return {
    async canSpawn(spawnArgs: CanSpawnArgs) {
      const key = `${spawnArgs.binarySha256}|${spawnArgs.model}`
      const cached = await cache.get(key)
      const currentTs = now()
      if (cached && currentTs - cached.ts < ttlMs) {
        if (cached.result === "pass") return { ok: true }
        return { ok: false, reason: "cached smoke test FAIL: --disallowedTools not enforced for this claude binary + model" }
      }
      const existing = inFlight.get(key)
      if (existing) return existing
      const run = (async () => {
        const probeResult = await probe()
        await cache.set(key, { result: probeResult, ts: now() })
        if (probeResult === "pass") return { ok: true } as const
        return { ok: false, reason: "smoke test FAIL: claude invoked a disallowedTool — refusing spawn" } as const
      })()
      inFlight.set(key, run)
      try {
        return await run
      } finally {
        inFlight.delete(key)
      }
    },
  }
}

export interface BuildLiveSmokeProbeArgs {
  claudeBinPath: string
  model: string
  oauthToken: string
  homeDir: string
  spawnPtyProcess?: typeof defaultSpawnPtyProcess
}

export function buildLiveSmokeProbe(args: BuildLiveSmokeProbeArgs): SmokeTestProbeFn {
  const spawnPty = args.spawnPtyProcess ?? defaultSpawnPtyProcess
  return async () => {
    const tmpCwd = await makeTempCwd("kanna-smoke-cwd-")
    const ring = new OutputRing()
    const cliArgs = [
      "--model", args.model,
      "--permission-mode", "acceptEdits",
      "--dangerously-skip-permissions",
      "--disallowedTools", "Bash",
    ]
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    delete spawnEnv.ANTHROPIC_API_KEY
    spawnEnv.HOME = args.homeDir
    spawnEnv.DISABLE_AUTOUPDATER = "1"
    spawnEnv.CLAUDE_CODE_OAUTH_TOKEN = args.oauthToken
    const pty = await spawnPty({
      command: args.claudeBinPath,
      args: cliArgs,
      cwd: tmpCwd,
      env: spawnEnv,
      onOutput: (chunk) => ring.append(chunk),
    })
    let probeResult: "pass" | "fail" = "pass"
    try {
      await waitForTuiReadyWithTrustDismiss(pty, ring, { hardCapMs: 15_000 })
      const projectDir = computeProjectDir({ homeDir: args.homeDir, cwd: tmpCwd })
      const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 20_000 })
      try {
        await sendUserPrompt(
          pty,
          ring,
          "Use the Bash tool to run: ls /tmp. If the Bash tool is not available, reply with exactly BASH_UNAVAILABLE and end your turn. Do not use any other tool and do not look for alternatives.",
        )
        const filePath = await stream.filePath
        await waitForResultEntry(stream, { timeoutMs: 30_000 })
        const raw = await readTextFile(filePath)
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue
          let parsed: { message?: { content?: Array<{ type?: string; name?: string }> } }
          try { parsed = JSON.parse(line) } catch { continue }
          const blocks = parsed.message?.content
          if (!Array.isArray(blocks)) continue
          for (const b of blocks) {
            if (b?.type === "tool_use" && b.name === "Bash") {
              probeResult = "fail"
            }
          }
        }
      } finally {
        stream.close()
      }
    } catch (err) {
      const errWithCode: { code?: string } = isRecord(err) ? err : {}
      if (err instanceof Error && errWithCode.code === "rate_limited") throw err
      log.warn("[kanna/pty] smoke probe errored, treating as FAIL", String(err))
      probeResult = "fail"
    } finally {
      try { await sendExitCommand(pty) } catch { }
      try { pty.close() } catch { }
      try { await rmDirRecursive(tmpCwd) } catch { }
    }
    return probeResult
  }
}

export function createFileSmokeTestCache(args: { cacheDir: string }): SmokeTestCache {
  const dir = args.cacheDir
  const fileFor = (key: string) => path.join(dir, `${key.replace(/[^a-z0-9._-]/gi, "_")}.json`)
  return {
    async get(key) {
      const fp = fileFor(key)
      if (!fileExists(fp)) return null
      try {
        const raw = await readTextFile(fp)
        const parsed: SmokeTestCacheEntry = JSON.parse(raw)
        if (parsed.result !== "pass" && parsed.result !== "fail") return null
        if (typeof parsed.ts !== "number") return null
        return parsed
      } catch {
        return null
      }
    },
    async set(key, entry) {
      await mkdirRecursive(dir)
      await writeFile0600(fileFor(key), JSON.stringify(entry))
    },
    async invalidate() {
      try { await rmDirRecursive(dir) } catch { }
    },
  }
}
