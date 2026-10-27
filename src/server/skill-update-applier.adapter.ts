import { assertSafeSkillId, assertSafeSkillSource, getGlobalSkillLockPath, NPX, skillsCliEnv } from "./skills-cli"
import { readTextFileOrThrow } from "./text-file-io.adapter"
import { isJsonObject, type JsonValue } from "../shared/json"
import { deriveSkillFolder, repinTarget } from "../shared/packages/skill-update-classifier"
import type { PackageUpdateApplier, PackageApplyResult, PackageUpdateEntry } from "../shared/packages/types"
import { applyDeadline, applyFailure, exitFailure, runApplyCommand, thrownFailure } from "./package-apply-command.adapter"

function buildUpdateSkillCommand(skillName: string): string[] {
  return [NPX, "skills", "update", assertSafeSkillId(skillName), "--global", "--yes"]
}

export function buildRepinSkillCommand(source: string, installPath: string | null, ref: string): string[] {
  const safeSource = assertSafeSkillSource(source)
  if (!/^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,127}$/.test(ref) || ref.includes("..")) {
    throw new Error("Skill ref is invalid.")
  }
  const folder = installPath ? deriveSkillFolder(installPath) : null
  if (folder !== null && (!/^[A-Za-z0-9_.\-/]+$/.test(folder) || folder.includes(".."))) {
    throw new Error("Skill path is invalid.")
  }
  const withFolder = folder ? `${safeSource}/${folder}` : safeSource
  return [NPX, "skills", "add", `${withFolder}#${ref}`, "--global", "--yes"]
}

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
    const fromRevision = pkg.revision

    let command: string[]
    try {
      const ref = repinTarget(pkg, pkg.update)
      command = ref
        ? buildRepinSkillCommand(pkg.source, pkg.installPath, ref)
        : buildUpdateSkillCommand(pkg.name)
    } catch (error) {
      return thrownFailure(pkg, [], error)
    }

    try {
      const run = await runApplyCommand(
        command,
        skillsCliEnv(),
        applyDeadline(signal),
      )
      if (run.exitCode !== 0) return exitFailure(pkg, command, run, "skills CLI")

      const toRevision = await readLockRevision(pkg.name)
      if (pkg.pinnedRef && toRevision !== null && toRevision === fromRevision) {
        return applyFailure(pkg, {
          command,
          stdout: run.stdout,
          stderr: run.stderr,
          toRevision,
          error: `skills CLI reported success but ${pkg.name} is unchanged — it is pinned to ${pkg.pinnedRef}.`,
        })
      }

      return { id: pkg.id, ok: true, fromRevision, toRevision, command, stdout: run.stdout, stderr: run.stderr, error: null }
    } catch (error) {
      return thrownFailure(pkg, command, error)
    }
  },
}
