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


const CSS_PATH = join(import.meta.dir, "../../..", "src/index.css")
const css = readFileSync(CSS_PATH, "utf8")

function durationVarName(token: MotionDurationName): string {
  return `--motion-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

function declaredDurations(): Map<string, number> {
  const found = new Map<string, number>()
  for (const match of css.matchAll(/^\s*(--motion-[a-z-]+):\s*(\d+)ms;/gm)) {
    found.set(match[1], Number(match[2]))
  }
  return found
}

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
    const controlPoints = (spelling: string) => spelling.replace(/^[a-zA-Z-]+\(|\)$/g, "")
    expect(controlPoints(MOTION_EASE.panel)).toBe(controlPoints(MOTION_EASE_CSS.panel))
  })
})

describe("DESIGN.md documents the real table", () => {
  const design = readFileSync(join(import.meta.dir, "../../..", "DESIGN.md"), "utf8")

  test("every token in the DESIGN.md table matches src/index.css", () => {
    const documented = new Map(
      [...design.matchAll(/\|\s*`(--motion-[a-z-]+)`\s*\|\s*(\d+)\s*ms\s*\|/g)].map(
        (match) => [match[1], Number(match[2])] as const,
      ),
    )

    expect(documented.size).toBeGreaterThan(0)

    const declared = declaredDurations()
    expect([...documented.entries()].sort()).toEqual([...declared.entries()].sort())
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
    for (const token of SEQUENCE_DURATIONS) {
      expect(MOTION_DURATION[token]).toBeGreaterThan(MAX_BEAT_MS)
    }
  })
})
