export interface UploadSettings {
  maxFileSizeMb: number
}

export const UPLOAD_DEFAULTS: UploadSettings = {
  maxFileSizeMb: 2048,
}

export const UPLOAD_MAX_FILE_SIZE_MB_MIN = 1
export const UPLOAD_MAX_FILE_SIZE_MB_MAX = 51200
