
interface ParsedSemver {
  name: string
  parts: readonly [number, number, number]
  prerelease: string | null
}

const SEMVER_TAG = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function parseSemverTag(name: string): ParsedSemver | null {
  const match = SEMVER_TAG.exec(name.trim())
  if (!match) return null
  const [, major, minor, patch, prerelease] = match
  return {
    name,
    parts: [Number(major), Number(minor), Number(patch)],
    prerelease: prerelease ?? null,
  }
}

function compareSemver(a: ParsedSemver, b: ParsedSemver): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (a.prerelease === b.prerelease) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return a.prerelease < b.prerelease ? -1 : 1
}

export function pickLatestSemverTag(names: readonly string[]): string | null {
  let best: ParsedSemver | null = null
  for (const name of names) {
    const parsed = parseSemverTag(name)
    if (!parsed) continue
    if (!best || compareSemver(parsed, best) > 0) best = parsed
  }
  return best?.name ?? null
}
