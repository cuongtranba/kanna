import os from "node:os"
import { assertSafeSkillId, getGlobalSkillLockPath } from "./ws-router-skills"
import { readTextFileOrThrow } from "./ws-router-io.adapter"
import { isJsonObject, type JsonValue } from "../shared/json"
import { deriveSkillFolder, repinTarget } from "../shared/packages/skill-update-classifier"
import type { PackageUpdateApplier, PackageApplyResult, PackageUpdateEntry } from "../shared/packages/types"

const APPLY_TIMEOUT_MS = 120_000

const NPX = process.platform === "win32" ? "npx.cmd" : "npx"

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
  return [NPX, "skills", "update", assertSafeSkillId(skillName), "--global", "--yes"]
}

/**
 * `skills add owner/repo[/folder]#ref` — the CLI's own source syntax
 * (its `appendFolderAndRef`), and the only way to move a pinned skill:
 * `skills update` resolves upstream AT the pin and exits 0 unchanged.
 */
export function buildRepinSkillCommand(source: string, installPath: string | null, ref: string): string[] {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    throw new Error("Skill source must be an owner/repo pair.")
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,127}$/.test(ref) || ref.includes("..")) {
    throw new Error("Skill ref is invalid.")
  }
  const folder = installPath ? deriveSkillFolder(installPath) : null
  if (folder !== null && (!/^[A-Za-z0-9_.\-/]+$/.test(folder) || folder.includes(".."))) {
    throw new Error("Skill path is invalid.")
  }
  const withFolder = folder ? `${source}/${folder}` : source
  return [NPX, "skills", "add", `${withFolder}#${ref}`, "--global", "--yes"]
}

/**
 * Re-read the lock's folder hash for one skill.
 *
 * The CLI exits 0 whether it moved the skill or decided it had nothing to do,
 * so the exit code alone cannot tell an applied update from a no-op. The lock
 * is the only place the answer is written down.
 */
async function readLockRevision(skillName: string): Promise<string | null> {
  try {
    const raw: JsonValue = JSON.parse(await readTextFileOrThrow(getGlobalSkillLockPath()))
    if (!isJsonObject(raw) || !isJsonObject(raw.skills)) return null
    const entry = raw.skills[skillName]
    if (!isJsonObject(entry)) return null
    return typeof entry.skillFolderHash === "string" && entry.skillFolderHash ? entry.skillFolderHash : null
  } catch {
    return null
  }
}

export const skillUpdateApplier: PackageUpdateApplier = {
  kind: "skill",

  async apply(pkg: PackageUpdateEntry, signal: AbortSignal): Promise<PackageApplyResult> {
    const cwd = os.homedir()
    const combinedSignal = AbortSignal.any([signal, AbortSignal.timeout(APPLY_TIMEOUT_MS)])
    const fromRevision = pkg.revision

    let command: string[]
    try {
      const ref = repinTarget(pkg, pkg.update)
      command = ref
        ? buildRepinSkillCommand(pkg.source, pkg.installPath, ref)
        : buildUpdateSkillCommand(pkg.name)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { id: pkg.id, ok: false, fromRevision, toRevision: null, command: [], stdout: "", stderr: "", error }
    }

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

      const toRevision = await readLockRevision(pkg.name)
      // A pinned skill whose revision did not move is a no-op dressed as a
      // success: the CLI resolved at the pin and found nothing to do. Reporting
      // ok would leave the card flagged Outdated behind a button that silently
      // does nothing — the defect this path exists to surface. Only pinned
      // packages are judged this way; for an unpinned one an unchanged revision
      // legitimately means "already current".
      if (pkg.pinnedRef && toRevision !== null && toRevision === fromRevision) {
        return {
          id: pkg.id,
          ok: false,
          fromRevision,
          toRevision,
          command,
          stdout,
          stderr,
          error: `skills CLI reported success but ${pkg.name} is unchanged — it is pinned to ${pkg.pinnedRef}.`,
        }
      }

      return { id: pkg.id, ok: true, fromRevision, toRevision, command, stdout, stderr, error: null }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      return { id: pkg.id, ok: false, fromRevision, toRevision: null, command, stdout: "", stderr: "", error }
    }
  },
}
