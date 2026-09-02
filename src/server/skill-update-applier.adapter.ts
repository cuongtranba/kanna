import os from "node:os"
import { assertSafeSkillId } from "./ws-router-skills"
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

function buildUpdateSkillCommand(skillName: string): string[] {
  return [
    process.platform === "win32" ? "npx.cmd" : "npx",
    "skills",
    "update",
    assertSafeSkillId(skillName),
    "--global",
    "--yes",
  ]
}

export const skillUpdateApplier: PackageUpdateApplier = {
  kind: "skill",

  async apply(pkg: InstalledPackage, signal: AbortSignal): Promise<PackageApplyResult> {
    const command = buildUpdateSkillCommand(pkg.name)
    const cwd = os.homedir()
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(APPLY_TIMEOUT_MS)])
    const fromRevision = pkg.revision
    try {
      const { stdout, stderr, exitCode } = await spawnCapture(
        command,
        cwd,
        { ...process.env, DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY ?? "1" },
        combinedSignal,
      )
      if (exitCode !== 0) {
        return {
          id: pkg.id,
          ok: false,
          fromRevision,
          toRevision: null,
          command,
          stdout,
          stderr,
          error: stderr.trim() || stdout.trim() || `skills CLI exited with code ${exitCode}`,
        }
      }
      return { id: pkg.id, ok: true, fromRevision, toRevision: null, command, stdout, stderr, error: null }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { id: pkg.id, ok: false, fromRevision, toRevision: null, command, stdout: "", stderr: "", error }
    }
  },
}
