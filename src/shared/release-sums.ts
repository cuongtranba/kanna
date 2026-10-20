const SHA256SUMS_LINE = /^([0-9a-fA-F]{64}) [ *](.+)$/

export const SHA256SUMS_ASSET = "SHA256SUMS"

export function parseSha256Sums(text: string): ReadonlyMap<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = SHA256SUMS_LINE.exec(line.trimEnd())
    if (match === null) continue
    const [, hash, name] = match
    if (hash !== undefined && name !== undefined) sums.set(name, hash.toLowerCase())
  }
  return sums
}

export function releaseAssetUrl(base: string, version: string, asset: string): string {
  return `${base.replace(/\/+$/, "")}/v${version}/${asset}`
}
