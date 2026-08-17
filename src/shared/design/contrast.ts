export type Oklch = { l: number; c: number; h: number }

function oklchToLinearSrgb(oklch: Oklch): [number, number, number] {
  const hRad = (oklch.h * Math.PI) / 180
  const a = oklch.c * Math.cos(hRad)
  const b = oklch.c * Math.sin(hRad)

  const lms_l = oklch.l + 0.3963377774 * a + 0.2158037573 * b
  const lms_m = oklch.l - 0.1055613458 * a - 0.0638541728 * b
  const lms_s = oklch.l - 0.0894841775 * a - 1.291485548 * b

  const l3 = lms_l ** 3
  const m3 = lms_m ** 3
  const s3 = lms_s ** 3

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
  const blue = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3

  return [r, g, blue]
}

function wcagLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * Math.max(0, Math.min(1, r)) +
    0.7152 * Math.max(0, Math.min(1, g)) +
    0.0722 * Math.max(0, Math.min(1, b))
  )
}

export function oklchLuminance(oklch: Oklch): number {
  const [r, g, b] = oklchToLinearSrgb(oklch)
  return wcagLuminance(r, g, b)
}

export function compositeOver(fg: Oklch, bg: Oklch, alpha: number): number {
  const [fr, fg_, fb] = oklchToLinearSrgb(fg)
  const [br, bg_, bb] = oklchToLinearSrgb(bg)
  return wcagLuminance(
    fr * alpha + br * (1 - alpha),
    fg_ * alpha + bg_ * (1 - alpha),
    fb * alpha + bb * (1 - alpha),
  )
}

export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export function contrastBetween(fgLuminance: number, bgLuminance: number): number {
  return contrastRatio(fgLuminance, bgLuminance)
}
