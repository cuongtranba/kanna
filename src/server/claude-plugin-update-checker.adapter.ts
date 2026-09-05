import os from "node:os"
import path from "node:path"
import { errorMessage } from "../shared/errors"
import { safeJsonParse } from "../shared/json"
import type { InstalledPackage, PackageUpdateChecker, PackageUpdateStatus } from "../shared/packages/types"
import {
  parseKnownMarketplaces,
  classifyClaudePluginUpdate,
} from "../shared/packages/parse-claude-plugin-marketplace"


export interface ClaudePluginCheckerSpawnResult {
  stdout: string
  exitCode: number
}

export interface ClaudePluginCheckerDeps {
  readFileFn: (p: string) => Promise<string | null>
  spawnFn: (
    cmd: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => Promise<ClaudePluginCheckerSpawnResult>
  claudeBinary: string | null
  pluginsDir: string
  refreshThrottleMs?: number
  nowFn?: () => number
}


interface ThrottleEntry {
  lastRefreshedAt: number
}


function pluginNameFromPackage(pkg: InstalledPackage): string {
  const atIdx = pkg.name.indexOf("@")
  return atIdx >= 0 ? pkg.name.slice(0, atIdx) : pkg.name
}

async function gitLogLatestSha(
  deps: ClaudePluginCheckerDeps,
  repoDir: string,
  subpath: string,
): Promise<string | null> {
  try {
    const { stdout, exitCode } = await deps.spawnFn(
      ["git", "log", "-1", "--format=%H", "--", subpath],
      repoDir,
      process.env,
    )
    if (exitCode !== 0) return null
    const sha = stdout.trim()
    return sha || null
  } catch {
    return null
  }
}

async function gitFetch(deps: ClaudePluginCheckerDeps, repoDir: string): Promise<void> {
  try {
    await deps.spawnFn(["git", "fetch", "--depth=1"], repoDir, process.env)
  } catch {
  }
}


export function createClaudePluginUpdateChecker(deps: ClaudePluginCheckerDeps): PackageUpdateChecker {
  const refreshThrottleMs = deps.refreshThrottleMs ?? 3_600_000
  const nowFn = deps.nowFn ?? (() => Date.now())

  const throttle = new Map<string, ThrottleEntry>()

  const shaCache = new Map<string, Map<string, string | null>>()

  async function loadKnownMarketplaces(): Promise<ReturnType<typeof parseKnownMarketplaces>> {
    const filePath = path.join(deps.pluginsDir, "known_marketplaces.json")
    try {
      const text = await deps.readFileFn(filePath)
      if (!text) return new Map()
      const raw = safeJsonParse(text)
      if (raw === null) return new Map()
      return parseKnownMarketplaces(raw)
    } catch {
      return new Map()
    }
  }

  async function maybeRefreshMarketplace(marketplaceName: string, installLocation: string): Promise<void> {
    const now = nowFn()
    const entry = throttle.get(marketplaceName)
    if (entry && now - entry.lastRefreshedAt < refreshThrottleMs) return
    throttle.set(marketplaceName, { lastRefreshedAt: now })
    await gitFetch(deps, installLocation)
  }

  async function getShasForMarketplace(
    marketplaceName: string,
    installLocation: string,
    pluginNames: string[],
  ): Promise<Map<string, string | null>> {
    await maybeRefreshMarketplace(marketplaceName, installLocation)

    const cached = shaCache.get(installLocation)
    const result = cached ?? new Map<string, string | null>()

    for (const pluginName of pluginNames) {
      if (!result.has(pluginName)) {
        const sha = await gitLogLatestSha(deps, installLocation, pluginName)
        result.set(pluginName, sha)
      }
    }

    shaCache.set(installLocation, result)
    return result
  }

  function unknownStatus(pkg: InstalledPackage, checkedAt: number, error: string): PackageUpdateStatus {
    return {
      id: pkg.id,
      availability: "unknown",
      currentRevision: pkg.revision,
      latestRevision: null,
      currentVersion: pkg.version,
      latestVersion: null,
      checkedAt,
      error,
    }
  }

  return {
    kind: "claude-plugin",

    async check(pkgs, signal) {
      const claudePlugins = pkgs.filter((p) => p.kind === "claude-plugin")
      if (claudePlugins.length === 0) return []

      const checkedAt = nowFn()

      const byMarketplace = new Map<string, InstalledPackage[]>()
      const noMarketplace: InstalledPackage[] = []

      for (const pkg of claudePlugins) {
        const marketplace = pkg.source
        if (!marketplace || marketplace === pluginNameFromPackage(pkg)) {
          noMarketplace.push(pkg)
        } else {
          const list = byMarketplace.get(marketplace)
          if (list) list.push(pkg)
          else byMarketplace.set(marketplace, [pkg])
        }
      }

      const results: PackageUpdateStatus[] = []

      for (const pkg of noMarketplace) {
        results.push(unknownStatus(pkg, checkedAt, "no marketplace source recorded"))
      }

      if (byMarketplace.size === 0) return results

      const marketplaces = await loadKnownMarketplaces()

      for (const [marketplaceName, marketplacePkgs] of byMarketplace) {
        if (signal.aborted) {
          for (const pkg of marketplacePkgs) {
            results.push(unknownStatus(pkg, checkedAt, "aborted"))
          }
          continue
        }

        const marketplaceEntry = marketplaces.get(marketplaceName)
        if (!marketplaceEntry) {
          for (const pkg of marketplacePkgs) {
            results.push(
              unknownStatus(pkg, checkedAt, `marketplace '${marketplaceName}' not found in known_marketplaces.json`),
            )
          }
          continue
        }

        const pluginNames = marketplacePkgs.map(pluginNameFromPackage)
        let shaMap: Map<string, string | null>
        try {
          shaMap = await getShasForMarketplace(
            marketplaceName,
            marketplaceEntry.installLocation,
            pluginNames,
          )
        } catch (err) {
          for (const pkg of marketplacePkgs) {
            results.push(unknownStatus(pkg, checkedAt, errorMessage(err)))
          }
          continue
        }

        for (const pkg of marketplacePkgs) {
          const pluginName = pluginNameFromPackage(pkg)
          const latestSha = shaMap.get(pluginName) ?? null
          const classification = classifyClaudePluginUpdate(pkg.revision, latestSha)

          results.push({
            id: pkg.id,
            availability: classification.availability,
            currentRevision: pkg.revision,
            latestRevision: classification.latestRevision,
            currentVersion: pkg.version,
            latestVersion: classification.latestVersion,
            checkedAt,
            error: classification.error,
          })
        }
      }

      return results
    },
  }
}


export function findClaudeBinary(): string | null {
  return Bun.which("claude") ?? null
}

export function buildClaudePluginCheckerDeps(claudeBinary: string | null): ClaudePluginCheckerDeps {
  const home = process.env.HOME ?? os.homedir()
  return {
    readFileFn: async (p) => {
      try {
        return await Bun.file(p).text()
      } catch {
        return null
      }
    },
    spawnFn: async (cmd, cwd, env) => {
      const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "ignore", env })
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      return { stdout, exitCode }
    },
    claudeBinary,
    pluginsDir: path.join(home, ".claude", "plugins"),
  }
}
