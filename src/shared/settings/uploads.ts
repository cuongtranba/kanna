import { isPlainObject, clampToRange } from "./plain-object"

export interface UploadSettings {
  maxFileSizeMb: number
}

export const UPLOAD_DEFAULTS: UploadSettings = {
  maxFileSizeMb: 100,
}

export const UPLOAD_MAX_FILE_SIZE_MB_MIN = 1
export const UPLOAD_MAX_FILE_SIZE_MB_MAX = 2048

export function normalizeUploadSettings<T>(value: T, warnings: string[]): UploadSettings {
  const source = isPlainObject(value) ? value : null
  if (value !== undefined && !source) {
    warnings.push("uploads must be an object")
  }

  const rawSize = source?.maxFileSizeMb
  if (rawSize === undefined) return { ...UPLOAD_DEFAULTS }

  if (typeof rawSize !== "number" || !Number.isFinite(rawSize)) {
    warnings.push("uploads.maxFileSizeMb must be a number")
    return { ...UPLOAD_DEFAULTS }
  }

  if (rawSize < UPLOAD_MAX_FILE_SIZE_MB_MIN || rawSize > UPLOAD_MAX_FILE_SIZE_MB_MAX) {
    warnings.push(
      `uploads.maxFileSizeMb must be between ${UPLOAD_MAX_FILE_SIZE_MB_MIN} and ${UPLOAD_MAX_FILE_SIZE_MB_MAX}`,
    )
    return {
      maxFileSizeMb: clampToRange(
        rawSize,
        UPLOAD_MAX_FILE_SIZE_MB_MIN,
        UPLOAD_MAX_FILE_SIZE_MB_MAX,
        UPLOAD_DEFAULTS.maxFileSizeMb,
      ),
    }
  }

  return { maxFileSizeMb: Math.round(rawSize) }
}
