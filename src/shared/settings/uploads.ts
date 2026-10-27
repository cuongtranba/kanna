import { normalizeBounded, type NumericBound } from "../numeric"
import { readSettingsSection } from "./read-fields"

export interface UploadSettings {
  maxFileSizeMb: number
}

export const UPLOAD_DEFAULTS: UploadSettings = {
  maxFileSizeMb: 2048,
}

export const UPLOAD_MAX_FILE_SIZE_MB_MIN = 1
export const UPLOAD_MAX_FILE_SIZE_MB_MAX = 51200

export const UPLOAD_MAX_FILE_SIZE_MB_BOUND = {
  path: "uploads.maxFileSizeMb",
  min: UPLOAD_MAX_FILE_SIZE_MB_MIN,
  max: UPLOAD_MAX_FILE_SIZE_MB_MAX,
  integer: false,
} as const satisfies NumericBound

export function normalizeUploadSettings<T>(value: T, warnings: string[]): UploadSettings {
  const source = readSettingsSection(value, "uploads", warnings).source
  return {
    maxFileSizeMb: normalizeBounded(
      UPLOAD_MAX_FILE_SIZE_MB_BOUND,
      source?.maxFileSizeMb,
      UPLOAD_DEFAULTS.maxFileSizeMb,
      "clamp",
      warnings,
    ),
  }
}
