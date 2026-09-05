export const BREAKPOINT_MD = 768

function isMeasured(width: number): boolean {
  return Number.isFinite(width) && width > 0
}

export function isMobileViewport(width: number): boolean {
  return isMeasured(width) && width < BREAKPOINT_MD
}

export function isDesktopViewport(width: number): boolean {
  return isMeasured(width) && width >= BREAKPOINT_MD
}
