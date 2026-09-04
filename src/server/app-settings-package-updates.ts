/**
 * Package-update settings normalization, lifted out of `app-settings.ts`.
 *
 * `app-settings.ts` is a listed oversized module pinned EXACTLY at its
 * architecture-budget ceiling, so it has no room for any new feature until
 * something cohesive leaves. This normalizer is the natural candidate: it owns
 * one feature's settings shape end to end (validation, clamping, and the
 * warnings it emits) and nothing else in `app-settings.ts` reaches into it.
 * Pure move — behaviour, warning strings and clamps are unchanged.
 */

import type { PackageUpdateSettings } from "../shared/types"
import type { PackageKind } from "../shared/packages/types"
import {
  PACKAGE_UPDATE_CHECK_INTERVAL_MAX_MS,
  PACKAGE_UPDATE_CHECK_INTERVAL_MIN_MS,
  PACKAGE_UPDATE_SETTINGS_DEFAULTS,
} from "../shared/types"
import { assertSafeSkillAgents } from "../shared/skill-agents"
/** Same guard `app-settings.ts` uses: narrows to a keyed record while keeping T. */
import { isPlainObject } from "../shared/settings/plain-object"


const VALID_PACKAGE_KINDS = new Set<string>(["skill", "claude-plugin", "codex-plugin"])

function isPackageKind(value: string): value is PackageKind {
  return VALID_PACKAGE_KINDS.has(value)
}

export function normalizePackageUpdateSettings<T>(value: T, warnings: string[]): PackageUpdateSettings {
  if (value === undefined || value === null) return { ...PACKAGE_UPDATE_SETTINGS_DEFAULTS }
  const src = isPlainObject(value) ? value : null
  if (!src) {
    warnings.push("packageUpdates must be an object")
    return { ...PACKAGE_UPDATE_SETTINGS_DEFAULTS }
  }

  const checkEnabled = typeof src.checkEnabled === "boolean" ? src.checkEnabled : PACKAGE_UPDATE_SETTINGS_DEFAULTS.checkEnabled

  let checkIntervalMs = PACKAGE_UPDATE_SETTINGS_DEFAULTS.checkIntervalMs
  if (src.checkIntervalMs !== undefined) {
    const raw = src.checkIntervalMs
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
      warnings.push("packageUpdates.checkIntervalMs must be a positive integer")
    } else if (raw < PACKAGE_UPDATE_CHECK_INTERVAL_MIN_MS) {
      warnings.push(`packageUpdates.checkIntervalMs ${raw} is below the 1h floor; clamped to ${PACKAGE_UPDATE_CHECK_INTERVAL_MIN_MS}`)
      checkIntervalMs = PACKAGE_UPDATE_CHECK_INTERVAL_MIN_MS
    } else if (raw > PACKAGE_UPDATE_CHECK_INTERVAL_MAX_MS) {
      warnings.push(`packageUpdates.checkIntervalMs ${raw} exceeds the 30d ceiling; clamped to ${PACKAGE_UPDATE_CHECK_INTERVAL_MAX_MS}`)
      checkIntervalMs = PACKAGE_UPDATE_CHECK_INTERVAL_MAX_MS
    } else {
      checkIntervalMs = raw
    }
  }

  const autoApply = typeof src.autoApply === "boolean" ? src.autoApply : PACKAGE_UPDATE_SETTINGS_DEFAULTS.autoApply

  let autoApplyKinds = PACKAGE_UPDATE_SETTINGS_DEFAULTS.autoApplyKinds
  if (src.autoApplyKinds !== undefined) {
    if (!Array.isArray(src.autoApplyKinds)) {
      warnings.push("packageUpdates.autoApplyKinds must be an array")
    } else {
      const validKinds: PackageKind[] = []
      for (const k of src.autoApplyKinds) {
        if (typeof k === "string" && isPackageKind(k)) {
          validKinds.push(k)
        } else {
          warnings.push(`packageUpdates.autoApplyKinds: unknown kind ${JSON.stringify(k)}; dropped`)
        }
      }
      autoApplyKinds = validKinds
    }
  }

  let skillAgents = PACKAGE_UPDATE_SETTINGS_DEFAULTS.skillAgents
  if (src.skillAgents !== undefined) {
    if (!Array.isArray(src.skillAgents)) {
      warnings.push("packageUpdates.skillAgents must be an array")
    } else {
      try {
        skillAgents = assertSafeSkillAgents(src.skillAgents.map(String))
      } catch (err) {
        warnings.push(`packageUpdates.skillAgents: ${err instanceof Error ? err.message : String(err)}; reset to defaults`)
      }
    }
  }

  return { checkEnabled, checkIntervalMs, autoApply, autoApplyKinds, skillAgents }
}
