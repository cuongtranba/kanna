export const PM2_MAX_MEMORY_RESTART_BYTES = 2 ** 31

export const SAFE_HOST_MEMORY_FRACTION = 0.8

export interface MemoryCeilingInput {
  totalBytes: number
  underPm2: boolean
}

export function resolveMemoryCeiling({ totalBytes, underPm2 }: MemoryCeilingInput): number {
  const hostCeiling = Number.isFinite(totalBytes) && totalBytes > 0
    ? totalBytes * SAFE_HOST_MEMORY_FRACTION
    : PM2_MAX_MEMORY_RESTART_BYTES
  return underPm2 ? Math.min(PM2_MAX_MEMORY_RESTART_BYTES, hostCeiling) : hostCeiling
}

export function resolveRssRatio(rssBytes: number, ceilingBytes: number): number {
  if (!Number.isFinite(ceilingBytes) || ceilingBytes <= 0) return 0
  return rssBytes / ceilingBytes
}
