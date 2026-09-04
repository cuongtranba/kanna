import os from "node:os"
import { errorMessage } from "../shared/errors"
import { safeJsonParse, type JsonValue } from "../shared/json"
import type { InstalledPackage, PackageUpdateChecker, PackageUpdateStatus } from "../shared/packages/types"
import { parseCodexPluginAvailable } from "../shared/packages/parse-codex-plugins"

// ─── Dependency interfaces ────────────────────────────────────────────────────

export interface CodexPluginCheckerSpawnResult {
  stdout: string
  exitCode: number
}

export interface CodexPluginCheckerDeps {
  /** Spawn a command and capture stdout + exit code. */
  spawnFn: (cmd: string[], env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<CodexPluginCheckerSpawnResult>
  /** Resolved `codex` binary path; null when unavailable. */
  codexBinary: string | null
  /** Minimum ms between marketplace upgrade runs (default 1 h). */
  refreshThrottleMs?: number
  /** Monotonic clock for throttle checks (default `Date.now`). */
  nowFn?: () => number
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface ThrottleEntry {
  lastRefreshedAt: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function unknownStatus(pkg: InstalledPackage, checkedAt: number, error: string): PackageUpdateStatus {
  return {
    id: pkg.id,
    availability: "unknown",
    currentRevision: null,
    latestRevision: null,
    currentVersion: pkg.version,
    latestVersion: null,
    checkedAt,
    error,
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createCodexPluginUpdateChecker(deps: CodexPluginCheckerDeps): PackageUpdateChecker {
  const refreshThrottleMs = deps.refreshThrottleMs ?? 3_600_000 // 1 h
  const nowFn = deps.nowFn ?? (() => Date.now())

  // Single throttle entry (upgrade applies to all marketplaces at once).
  // Initialize to -Infinity so the first call always triggers an upgrade.
  const throttle: ThrottleEntry = { lastRefreshedAt: -Infinity }

  async function maybeRunMarketplaceUpgrade(signal: AbortSignal): Promise<void> {
    if (!deps.codexBinary) return
    const now = nowFn()
    if (now - throttle.lastRefreshedAt < refreshThrottleMs) return
    throttle.lastRefreshedAt = now
    try {
      await deps.spawnFn([deps.codexBinary, "plugin", "marketplace", "upgrade"], process.env, signal)
    } catch {
      // best-effort
    }
  }

  return {
    kind: "codex-plugin",

    async check(pkgs, signal) {
      const codexPkgs = pkgs.filter((p) => p.kind === "codex-plugin")
      if (codexPkgs.length === 0) return []

      const checkedAt = nowFn()

      if (!deps.codexBinary) {
        return codexPkgs.map((pkg) => unknownStatus(pkg, checkedAt, "codex binary not found"))
      }

      if (signal.aborted) {
        return codexPkgs.map((pkg) => unknownStatus(pkg, checkedAt, "aborted"))
      }

      await maybeRunMarketplaceUpgrade(signal)

      let rawOutput: string
      try {
        const { stdout, exitCode } = await deps.spawnFn(
          [deps.codexBinary, "plugin", "list", "--json"],
          process.env,
          signal,
        )
        if (exitCode !== 0) {
          return codexPkgs.map((pkg) =>
            unknownStatus(pkg, checkedAt, `codex plugin list exited with code ${exitCode}`),
          )
        }
        rawOutput = stdout
      } catch (err) {
        const msg = errorMessage(err)
        return codexPkgs.map((pkg) => unknownStatus(pkg, checkedAt, msg))
      }

      const parsed: JsonValue | null = safeJsonParse(rawOutput)
      if (parsed === null) {
        return codexPkgs.map((pkg) => unknownStatus(pkg, checkedAt, "codex plugin list: invalid JSON"))
      }

      const available = parseCodexPluginAvailable(parsed)

      return codexPkgs.map((pkg) => {
        // pkg.name is the raw plugin id (without the "codex-plugin:" prefix)
        const pluginId = pkg.name
        const availableEntry = available.get(pluginId)

        if (availableEntry !== undefined) {
          return {
            id: pkg.id,
            availability: "outdated" as const,
            currentRevision: null,
            latestRevision: null,
            currentVersion: pkg.version,
            latestVersion: availableEntry.version,
            checkedAt,
            error: null,
          }
        }

        return {
          id: pkg.id,
          availability: "up_to_date" as const,
          currentRevision: null,
          latestRevision: null,
          currentVersion: pkg.version,
          latestVersion: null,
          checkedAt,
          error: null,
        }
      })
    },
  }
}

// ─── Default deps builder ─────────────────────────────────────────────────────

export function buildCodexPluginCheckerDeps(codexBinary: string | null): CodexPluginCheckerDeps {
  return {
    spawnFn: async (cmd, env, signal) => {
      const proc = Bun.spawn(cmd, {
        stdout: "pipe",
        stderr: "ignore",
        env,
        signal,
      })
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      return { stdout, exitCode }
    },
    codexBinary,
  }
}

export function buildCodexPluginCheckerDepsForEnv(): CodexPluginCheckerDeps {
  const home = process.env.HOME ?? os.homedir()
  const codexBinary = process.env.CODEX_BINARY_PATH ?? `${home}/.local/bin/codex`
  return buildCodexPluginCheckerDeps(codexBinary)
}

export function findCodexBinary(): string {
  const home = process.env.HOME ?? os.homedir()
  return process.env.CODEX_BINARY_PATH ?? `${home}/.local/bin/codex`
}
