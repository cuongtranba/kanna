import { parseOklchColor, type Oklch } from "./contrast"

export type Theme = "light" | "dark"
export type TokenMap = Record<string, Oklch>

const PROP_RE = /--([a-z0-9-]+)\s*:\s*(.+?)\s*;/g

function parseBlock(block: string): Map<string, string> {
  const raw = new Map<string, string>()
  for (const m of block.matchAll(PROP_RE)) {
    raw.set(m[1], m[2].trim())
  }
  return raw
}

function parseOklch(value: string): Oklch | null {
  const parsed = parseOklchColor(value)
  return parsed === null ? null : { l: parsed.l, c: parsed.c, h: parsed.h }
}

function resolve(name: string, raw: Map<string, string>, visited = new Set<string>()): Oklch | null {
  if (visited.has(name)) return null
  visited.add(name)
  const value = raw.get(name)
  if (!value) return null
  const direct = parseOklch(value)
  if (direct) return direct
  const varMatch = /^var\(--([a-z0-9-]+)\)$/.exec(value)
  if (varMatch) return resolve(varMatch[1], raw, visited)
  return null
}

function extractBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?:^|\\s)${escaped}\\s*\\{`, "m")
  const m = re.exec(css)
  if (!m) return ""
  const open = m.index + m[0].lastIndexOf("{")
  let depth = 0
  let end = open
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++
    else if (css[end] === "}") {
      depth--
      if (depth === 0) break
    }
  }
  return css.slice(open + 1, end)
}

export function parseTokens(css: string): Record<Theme, TokenMap> {
  const lightRaw = parseBlock(extractBlock(css, ":root"))
  const darkRaw = parseBlock(extractBlock(css, ".dark"))

  const light: TokenMap = {}
  const dark: TokenMap = {}

  for (const name of lightRaw.keys()) {
    const oklch = resolve(name, lightRaw)
    if (oklch) light[name] = oklch
  }

  for (const name of darkRaw.keys()) {
    const resolved = resolve(name, darkRaw) ?? resolve(name, lightRaw)
    if (resolved) dark[name] = resolved
  }

  for (const [name, oklch] of Object.entries(light)) {
    if (!dark[name]) dark[name] = oklch
  }

  return { light, dark }
}
