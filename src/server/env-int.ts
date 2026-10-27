export function readIntEnv(value: string | undefined, fallback: number, { min = 1 }: { min?: number } = {}): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback
}
