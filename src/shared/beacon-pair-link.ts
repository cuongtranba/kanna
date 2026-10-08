export const BEACON_LINK_SCHEME = "kanna-beacon"
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const PAIRING_CODE_LENGTH = 8
export const BEACON_DOWNLOAD_PAGE = "https://github.com/cuongtranba/kanna/releases/latest"

export interface BeaconPairingTarget {
  kannaUrl: string
  code: string
}

const CODE_PATTERN = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`)
const CLI_PAIR = /(?:^|[\s"'\\/])kanna-beacon(?:\.exe)?["']?\s+pair\s+(\S+)\s+(\S+)\s*$/i

export function buildBeaconPairLink(target: BeaconPairingTarget): string {
  return `${BEACON_LINK_SCHEME}://pair?url=${encodeURIComponent(target.kannaUrl)}&code=${encodeURIComponent(target.code)}`
}

function normalizeKannaUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.host === "") return null
  return raw.trim().replace(/\/+$/, "")
}

function normalizeCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "").toUpperCase()
  return CODE_PATTERN.test(code) ? code : null
}

function toTarget(rawUrl: string | null, rawCode: string | null): BeaconPairingTarget | null {
  if (rawUrl === null || rawCode === null) return null
  const kannaUrl = normalizeKannaUrl(rawUrl)
  const code = normalizeCode(rawCode)
  return kannaUrl === null || code === null ? null : { kannaUrl, code }
}

function parseLink(text: string): BeaconPairingTarget | null {
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  if (parsed.protocol !== `${BEACON_LINK_SCHEME}:`) return null
  const action = parsed.host === "" ? parsed.pathname.replace(/^\/+/, "") : parsed.host
  if (action !== "pair") return null
  return toTarget(parsed.searchParams.get("url"), parsed.searchParams.get("code"))
}

export function parseBeaconPairingInput(input: string): BeaconPairingTarget | null {
  const text = input.trim()
  if (text.length === 0) return null
  if (text.toLowerCase().startsWith(`${BEACON_LINK_SCHEME}://`)) return parseLink(text)
  const command = CLI_PAIR.exec(text)
  return command ? toTarget(command[1] ?? null, command[2] ?? null) : null
}
