import os from "node:os"
import { toError } from "../shared/errors"
import type { InstalledPackage, PackageApplyResult, PackageKind, PackageUpdateApplier } from "../shared/packages/types"
import { spawnCapture, type CapturedRun } from "./process-utils.adapter"

const APPLY_TIMEOUT_MS = 120_000

export interface ApplyFailure {
  command: string[]
  error: string
  stdout?: string
  stderr?: string
  toRevision?: string | null
}

export function applyFailure(pkg: InstalledPackage, failure: ApplyFailure): PackageApplyResult {
  return {
    id: pkg.id,
    ok: false,
    fromRevision: pkg.revision,
    toRevision: failure.toRevision ?? null,
    command: failure.command,
    stdout: failure.stdout ?? "",
    stderr: failure.stderr ?? "",
    error: failure.error,
  }
}

export function exitFailure(pkg: InstalledPackage, command: string[], run: CapturedRun, label: string): PackageApplyResult {
  return applyFailure(pkg, {
    command,
    stdout: run.stdout,
    stderr: run.stderr,
    error: run.stderr.trim() || run.stdout.trim() || `${label} exited with code ${run.exitCode}`,
  })
}

export function thrownFailure<Thrown>(pkg: InstalledPackage, command: string[], thrown: Thrown): PackageApplyResult {
  return applyFailure(pkg, { command, error: toError(thrown).message })
}

export function applyDeadline(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(APPLY_TIMEOUT_MS)])
}

export function runApplyCommand(command: string[], env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<CapturedRun> {
  return spawnCapture(command, { cwd: os.homedir(), env, signal })
}

export interface CliPluginUpdateSpec {
  kind: PackageKind
  cli: string
  refreshCommand: (binary: string, pkg: InstalledPackage) => string[] | null
  installCommand: (binary: string, pkg: InstalledPackage) => string[]
  installLabel: string
}

export function createCliPluginUpdateApplier(binary: string | null, spec: CliPluginUpdateSpec): PackageUpdateApplier {
  return {
    kind: spec.kind,

    async apply(pkg, signal) {
      if (!binary) return applyFailure(pkg, { command: [], error: `${spec.cli} binary not found` })

      const deadline = applyDeadline(signal)
      const refresh = spec.refreshCommand(binary, pkg)
      if (refresh) {
        try {
          await runApplyCommand(refresh, process.env, deadline)
        } catch {
        }
      }

      const install = spec.installCommand(binary, pkg)
      try {
        const run = await runApplyCommand(install, process.env, deadline)
        if (run.exitCode !== 0) return exitFailure(pkg, install, run, spec.installLabel)
        return { id: pkg.id, ok: true, fromRevision: pkg.revision, toRevision: null, command: install, stdout: run.stdout, stderr: run.stderr, error: null }
      } catch (error) {
        return thrownFailure(pkg, install, error)
      }
    },
  }
}
