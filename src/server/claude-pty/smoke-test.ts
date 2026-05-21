import { mkdir, mkdtemp, readFile, writeFile as writeFileFs, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { OutputRing } from "./output-ring"
import { spawnPtyProcess as defaultSpawnPtyProcess } from "./pty-process"
import { waitForTuiReadyWithTrustDismiss, sendUserPrompt, sendExitCommand } from "./tui-control"
import { startTranscriptStream, waitForResultEntry } from "./tui-source"
import { computeProjectDir } from "./jsonl-path"

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
  return {
    async canSpawn(spawnArgs: CanSpawnArgs) {
      const key = `${spawnArgs.binarySha256}|${spawnArgs.model}`
      const cached = await cache.get(key)
      const currentTs = now()
      if (cached && currentTs - cached.ts < ttlMs) {
        if (cached.result === "pass") return { ok: true }
        return { ok: false, reason: "cached smoke test FAIL: --disallowedTools not enforced for this claude binary + model" }
      }
      const probeResult = await probe()
      await cache.set(key, { result: probeResult, ts: currentTs })
      if (probeResult === "pass") return { ok: true }
      return { ok: false, reason: "smoke test FAIL: claude invoked a disallowedTool — refusing spawn" }
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
    const tmpCwd = await mkdtemp(path.join(tmpdir(), "kanna-smoke-cwd-"))
    const ring = new OutputRing()
    const cliArgs = [
      "--model", args.model,
      "--permission-mode", "acceptEdits",
      "--dangerously-skip-permissions",
      "--strict-mcp-config",
      "--disallowedTools", "Bash",
    ]
    const spawnEnv: NodeJS.ProcessEnv = { ...process.env }
    delete spawnEnv.ANTHROPIC_API_KEY
    spawnEnv.HOME = args.homeDir
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
      // Start watching the transcript directory before sending the prompt.
      // The JSONL file is created by claude at session-init (before any user
      // turn), so awaiting stream.filePath confirms the API connection is live
      // and prevents sending the probe prompt before claude is ready to process
      // it (which would silently drop the turn and cause a transcript timeout).
      const stream = await startTranscriptStream({ projectDir, firstFileTimeoutMs: 20_000 })
      try {
        const filePath = await stream.filePath
        await sendUserPrompt(pty, "Run the command ls -la /tmp using the Bash tool now. Just do it.")
        await waitForResultEntry(stream, { timeoutMs: 30_000 })
        const raw = await readFile(filePath, "utf8")
        for (const line of raw.split("\n")) {
          if (!line.trim()) continue
          let parsed: { message?: { content?: Array<{ type?: string; name?: string }> } }
          try { parsed = JSON.parse(line) as { message?: { content?: Array<{ type?: string; name?: string }> } } } catch { continue }
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
      // Rate-limit errors must not be cached as "fail" — they're transient.
      // Re-throw so the gate propagates the error without poisoning the cache.
      if (err instanceof Error && (err as Error & { code?: string }).code === "rate_limited") throw err
      console.warn("[kanna/pty] smoke probe errored, treating as FAIL", err)
      probeResult = "fail"
    } finally {
      try { await sendExitCommand(pty) } catch { /* swallow */ }
      try { pty.close() } catch { /* swallow */ }
      try { await rm(tmpCwd, { recursive: true, force: true }) } catch { /* swallow */ }
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
      if (!existsSync(fp)) return null
      try {
        const raw = await readFile(fp, "utf8")
        const parsed = JSON.parse(raw) as SmokeTestCacheEntry
        if (parsed.result !== "pass" && parsed.result !== "fail") return null
        if (typeof parsed.ts !== "number") return null
        return parsed
      } catch {
        return null
      }
    },
    async set(key, entry) {
      await mkdir(dir, { recursive: true })
      await writeFileFs(fileFor(key), JSON.stringify(entry), { encoding: "utf8", mode: 0o600 })
    },
    async invalidate() {
      try { await rm(dir, { recursive: true, force: true }) } catch { /* swallow */ }
    },
  }
}
