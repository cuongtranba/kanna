import os from "node:os"
import type { InstalledPackage, PackageUpdateApplier, PackageApplyResult } from "../shared/packages/types"

const APPLY_TIMEOUT_MS = 120_000

async function spawnCapture(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe", env })
  const onAbort = () => { try { proc.kill() } catch { /* best-effort */ } }
  signal.addEventListener("abort", onAbort, { once: true })
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

/**
 * Returns a PackageUpdateApplier for claude-plugin packages.
 *
 * Apply sequence per the issue spec (verified against upstream docs):
 * 1. `claude plugin marketplace update <marketplace>` — refreshes the marketplace git clone
 * 2. `claude plugin update <plugin>@<marketplace> -s user -y` — installs the updated version
 *
 * pkg.name has the format `pluginName@marketplaceName` (or just `pluginName`).
 */
export function createClaudePluginUpdateApplier(claudeBinary: string | null): PackageUpdateApplier {
  return {
    kind: "claude-plugin",

    async apply(pkg: InstalledPackage, signal: AbortSignal): Promise<PackageApplyResult> {
      if (!claudeBinary) {
        return {
          id: pkg.id,
          ok: false,
          fromRevision: pkg.revision,
          toRevision: null,
          command: [],
          stdout: "",
          stderr: "",
          error: "claude binary not found",
        }
      }

      // pkg.name is `pluginName@marketplaceName` (or bare pluginName with no marketplace)
      const atIdx = pkg.name.indexOf("@")
      const pluginName = atIdx >= 0 ? pkg.name.slice(0, atIdx) : pkg.name
      const marketplaceName = atIdx >= 0 ? pkg.name.slice(atIdx + 1) : null

      const cwd = os.homedir()
      const env = process.env
      const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(APPLY_TIMEOUT_MS)])
      const fromRevision = pkg.revision

      // Step 1: refresh the marketplace (best-effort; only when marketplace is known)
      if (marketplaceName) {
        const refreshCmd = [claudeBinary, "plugin", "marketplace", "update", marketplaceName]
        try {
          await spawnCapture(refreshCmd, cwd, env, combinedSignal)
        } catch {
          // best-effort refresh; proceed with the update even if this fails
        }
      }

      // Step 2: update the plugin using the qualified name (plugin@marketplace)
      const qualifiedName = marketplaceName ? `${pluginName}@${marketplaceName}` : pluginName
      const updateCmd = [claudeBinary, "plugin", "update", qualifiedName, "-s", "user", "-y"]

      try {
        const { stdout, stderr, exitCode } = await spawnCapture(updateCmd, cwd, env, combinedSignal)
        if (exitCode !== 0) {
          return {
            id: pkg.id,
            ok: false,
            fromRevision,
            toRevision: null,
            command: updateCmd,
            stdout,
            stderr,
            error: stderr.trim() || stdout.trim() || `claude plugin update exited with code ${exitCode}`,
          }
        }
        return { id: pkg.id, ok: true, fromRevision, toRevision: null, command: updateCmd, stdout, stderr, error: null }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { id: pkg.id, ok: false, fromRevision, toRevision: null, command: updateCmd, stdout: "", stderr: "", error }
      }
    },
  }
}
