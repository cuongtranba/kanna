import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  MAX_BEAT_MS,
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_EASE_CSS,
  SEQUENCE_DURATIONS,
  type MotionDurationName,
} from "../../client/lib/motion/tokens"

/**
 * The motion vocabulary is defined twice — once as CSS custom properties in
 * src/index.css (for rules) and once as numbers in
 * src/client/lib/motion/tokens.ts (because anime.js and Motion take numbers,
 * not `var()`). Two definitions of one value drift, and a drifted duration is
 * invisible: nothing breaks, the app just animates two panels at two speeds.
 *
 * This is the gate that makes "the token table is the only timing values any
 * component may use" a fact rather than a note. It is the same discipline
 * shellChrome.ts applies to --shell-top-band, enforced instead of documented.
 *
 * It lives under src/server/design/ because the client seal bans node:fs from
 * src/client/** — including its tests — so a suite that reads source files has
 * to sit here, next to raw-ink-guard and tone-pairings.
 */

const CSS_PATH = join(import.meta.dir, "../../..", "src/index.css")
const css = readFileSync(CSS_PATH, "utf8")

/** `staggerTight` → `--motion-stagger-tight`. */
function durationVarName(token: MotionDurationName): string {
  return `--motion-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

/** Every `--motion-*: <n>ms` declaration in index.css, by property name. */
function declaredDurations(): Map<string, number> {
  const found = new Map<string, number>()
  for (const match of css.matchAll(/^\s*(--motion-[a-z-]+):\s*(\d+)ms;/gm)) {
    found.set(match[1], Number(match[2]))
  }
  return found
}

/** Every `--motion-ease-*` declaration in index.css, by property name. */
function declaredEasings(): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of css.matchAll(/^\s*(--motion-ease-[a-z-]+):\s*([^;]+);/gm)) {
    found.set(match[1], match[2].trim())
  }
  return found
}

describe("motion tokens agree between CSS and TypeScript", () => {
  test("every duration token is declared in index.css with the same value", () => {
    const declared = declaredDurations()
    const mismatches: string[] = []

    for (const [token, ms] of Object.entries(MOTION_DURATION)) {
      const property = durationVarName(token as MotionDurationName)
      const cssValue = declared.get(property)
      if (cssValue === undefined) {
        mismatches.push(`${property} is missing from src/index.css (tokens.ts has ${ms}ms)`)
      } else if (cssValue !== ms) {
        mismatches.push(`${property} is ${cssValue}ms in CSS but ${ms}ms in tokens.ts`)
      }
    }

    expect(mismatches).toEqual([])
  })

  test("index.css declares no motion duration TypeScript does not know about", () => {
    const known = new Set(
      Object.keys(MOTION_DURATION).map((token) => durationVarName(token as MotionDurationName)),
    )
    const orphans = [...declaredDurations().keys()].filter(
      (property) => !property.startsWith("--motion-ease-") && !known.has(property),
    )

    expect(orphans).toEqual([])
  })

  test("every CSS easing token matches MOTION_EASE_CSS", () => {
    const declared = declaredEasings()
    const mismatches: string[] = []

    for (const [name, curve] of Object.entries(MOTION_EASE_CSS)) {
      const property = `--motion-ease-${name}`
      const cssValue = declared.get(property)
      if (cssValue === undefined) {
        mismatches.push(`${property} is missing from src/index.css`)
      } else if (cssValue !== curve) {
        mismatches.push(`${property} is "${cssValue}" in CSS but "${curve}" in tokens.ts`)
      }
    }

    expect(mismatches).toEqual([])
    expect([...declared.keys()].sort()).toEqual(
      Object.keys(MOTION_EASE_CSS)
        .map((name) => `--motion-ease-${name}`)
        .sort(),
    )
  })

  test("the anime.js and CSS spellings of `panel` describe the same curve", () => {
    // anime.js: "cubicBezier(0.22, 1, 0.36, 1)" — CSS: "cubic-bezier(0.22, 1, 0.36, 1)".
    // Same four control points, two syntaxes; a change to one must change both.
    const controlPoints = (spelling: string) => spelling.replace(/^[a-zA-Z-]+\(|\)$/g, "")
    expect(controlPoints(MOTION_EASE.panel)).toBe(controlPoints(MOTION_EASE_CSS.panel))
  })
})

describe("no single beat exceeds the ceiling", () => {
  test("every duration but a declared sequence stays within MAX_BEAT_MS", () => {
    const overruns = Object.entries(MOTION_DURATION)
      .filter(([token]) => !SEQUENCE_DURATIONS.has(token as MotionDurationName))
      .filter(([, ms]) => ms > MAX_BEAT_MS)
      .map(([token, ms]) => `${token} is ${ms}ms (ceiling ${MAX_BEAT_MS}ms)`)

    expect(overruns).toEqual([])
  })

  test("a sequence token is a sum, so it may exceed the ceiling", () => {
    // Pins the exemption to something real: if `sequence` ever drops under the
    // ceiling the exemption is dead weight and should be deleted, not kept as
    // a hole a future beat can be parked in.
    for (const token of SEQUENCE_DURATIONS) {
      expect(MOTION_DURATION[token]).toBeGreaterThan(MAX_BEAT_MS)
    }
  })
})
