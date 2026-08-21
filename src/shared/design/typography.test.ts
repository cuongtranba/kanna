import { describe, expect, test } from "bun:test"
import {
  DEFAULT_FONT_SCALE_STEP,
  FONT_SCALE_MULTIPLIERS,
  FONT_SCALE_STEPS,
  isFontScaleStep,
  resolveEffectiveScaleStep,
  resolveFontScale,
  resolveTypographyVars,
  type FontScaleStep,
} from "./typography"

describe("FONT_SCALE_STEPS / FONT_SCALE_MULTIPLIERS / DEFAULT_FONT_SCALE_STEP", () => {
  test("steps list is the five documented steps in order", () => {
    expect(FONT_SCALE_STEPS).toEqual(["sm", "md", "lg", "xl", "xxl"])
  })

  test("multipliers match the documented table", () => {
    expect(FONT_SCALE_MULTIPLIERS).toEqual({
      sm: 0.875,
      md: 1,
      lg: 1.125,
      xl: 1.25,
      xxl: 1.5,
    })
  })

  test("default step is md", () => {
    expect(DEFAULT_FONT_SCALE_STEP).toBe("md")
  })
})

describe("isFontScaleStep", () => {
  test("recognizes all five valid steps", () => {
    for (const step of FONT_SCALE_STEPS) {
      expect(isFontScaleStep(step)).toBe(true)
    }
  })

  // Each case is wrapped in a single-element tuple ([c]) rather than passed as a bare
  // array of scalars: bun's test.each spreads an array *row* as positional arguments,
  // so an un-wrapped `[]` row (one of our garbage cases) would be spread to zero
  // arguments instead of passed as the single value `[]` — wrapping keeps every row
  // shape uniform regardless of what the case value itself is.
  test.each([undefined, null, "", "MD", "huge", 0, Number.NaN, {}, [], "SM", "medium"].map((c) => [c]))(
    "rejects garbage input %p",
    (value) => {
      expect(isFontScaleStep(value)).toBe(false)
    },
  )
})

describe("resolveFontScale", () => {
  test.each(Object.entries(FONT_SCALE_MULTIPLIERS))(
    "maps step %s to its documented multiplier",
    (step, multiplier) => {
      expect(resolveFontScale(step)).toBe(multiplier)
    },
  )

  test.each([undefined, null, "", "MD", "huge", 0, Number.NaN, {}, []].map((c) => [c]))(
    "total: garbage input %p resolves to the md multiplier (1)",
    (value) => {
      expect(resolveFontScale(value)).toBe(1)
    },
  )
})

describe("resolveEffectiveScaleStep — pure precedence: deviceOverride ?? serverDefault ?? md", () => {
  test("both set: device override wins", () => {
    expect(resolveEffectiveScaleStep("xxl", "lg")).toBe("xxl")
  })

  test("only device override set", () => {
    expect(resolveEffectiveScaleStep("lg", undefined)).toBe("lg")
  })

  test("only server default set", () => {
    expect(resolveEffectiveScaleStep(undefined, "xl")).toBe("xl")
  })

  test("neither set falls back to md", () => {
    expect(resolveEffectiveScaleStep(undefined, undefined)).toBe("md")
  })

  test("neither set (null) falls back to md", () => {
    expect(resolveEffectiveScaleStep(null, null)).toBe("md")
  })

  test("garbage device override + valid server default: server wins (garbage is not an override)", () => {
    expect(resolveEffectiveScaleStep("huge", "lg")).toBe("lg")
  })

  test("garbage device override + no server default falls back to md", () => {
    expect(resolveEffectiveScaleStep("huge", undefined)).toBe("md")
  })

  test("garbage device override + garbage server default falls back to md", () => {
    expect(resolveEffectiveScaleStep("huge", "also-garbage")).toBe("md")
  })

  test("never reads a store: is a plain function of exactly its two arguments", () => {
    // Same two inputs, called repeatedly, must yield the same output every time —
    // proof there is no hidden state (store, clock, random) influencing the result.
    const a = resolveEffectiveScaleStep("xl", "sm")
    const b = resolveEffectiveScaleStep("xl", "sm")
    const c = resolveEffectiveScaleStep("xl", "sm")
    expect(a).toBe("xl")
    expect(b).toBe("xl")
    expect(c).toBe("xl")
  })
})

describe("resolveTypographyVars — returns a MAP of CSS custom properties", () => {
  test("undefined preference returns the md-scale map", () => {
    expect(resolveTypographyVars(undefined)).toEqual({ "--kanna-font-scale": "1" })
  })

  test("lg preference deep-equals the documented map", () => {
    expect(resolveTypographyVars({ scale: "lg" })).toEqual({ "--kanna-font-scale": "1.125" })
  })

  test.each(Object.entries(FONT_SCALE_MULTIPLIERS))(
    "%s preference maps to its documented multiplier string",
    (step, multiplier) => {
      expect(resolveTypographyVars({ scale: <FontScaleStep>step })).toEqual({
        "--kanna-font-scale": String(multiplier),
      })
    },
  )

  test("result is a plain object map, not a string and not a function", () => {
    const result = resolveTypographyVars({ scale: "sm" })
    expect(typeof result).toBe("object")
    expect(result).not.toBeNull()
    expect(Array.isArray(result)).toBe(false)
    for (const value of Object.values(result)) {
      expect(typeof value).toBe("string")
    }
  })
})
