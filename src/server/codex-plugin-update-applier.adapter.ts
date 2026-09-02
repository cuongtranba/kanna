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
 * Returns a PackageUpdateApplier for codex-plugin packages.
 *
 * There is no `codex plugin update` command (verified).
 * Apply sequence:
 * 1. `codex plugin marketplace upgrade` — refresh the snapshot (best-effort)
 * 2. `codex plugin add <pluginId>` — re-add; the CLI updates in place when the plugin is installed.
 *    If re-add fails (exit ≠ 0), report the error rather than attempting a destructive remove+add.
 */
export function createCodexPluginUpdateApplier(codexBinary: string | null): PackageUpdateApplier {
  return {
    kind: "codex-plugin",

    async apply(pkg: InstalledPackage, signal: AbortSignal): Promise<PackageApplyResult> {
      if (!codexBinary) {
        return {
          id: pkg.id,
          ok: false,
          fromRevision: pkg.revision,
          toRevision: null,
          command: [],
          stdout: "",
          stderr: "",
          error: "codex binary not found",
        }
      }

      const cwd = os.homedir()
      const env = process.env
      const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(APPLY_TIMEOUT_MS)])
      const fromRevision = pkg.revision

      // Step 1: refresh the marketplace snapshot (best-effort)
      const upgradeCmd = [codexBinary, "plugin", "marketplace", "upgrade"]
      try {
        await spawnCapture(upgradeCmd, cwd, env, combinedSignal)
      } catch {
        // best-effort
      }

      // Step 2: re-add to update in place (plugin name is pkg.name)
      const addCmd = [codexBinary, "plugin", "add", pkg.name]
      try {
        const { stdout, stderr, exitCode } = await spawnCapture(addCmd, cwd, env, combinedSignal)
        if (exitCode !== 0) {
          return {
            id: pkg.id,
            ok: false,
            fromRevision,
            toRevision: null,
            command: addCmd,
            stdout,
            stderr,
            error: stderr.trim() || stdout.trim() || `codex plugin add exited with code ${exitCode}`,
          }
        }
        return { id: pkg.id, ok: true, fromRevision, toRevision: null, command: addCmd, stdout, stderr, error: null }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        return { id: pkg.id, ok: false, fromRevision, toRevision: null, command: addCmd, stdout: "", stderr: "", error }
      }
    },
  }
}
