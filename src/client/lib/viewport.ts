/**
 * The single responsive pivot for the whole client.
 *
 * Kanna previously carried three separate breakpoint constants that had drifted
 * (768 for the sidebar swipe gesture, 768 for the mobile right-sidebar overlay,
 * 640 as the default for `useIsMobile`). Every new responsive surface must read
 * from here so a fourth cannot appear.
 *
 * Matches Tailwind's `md` so JS-side decisions and `md:` utility classes agree.
 */
export const BREAKPOINT_MD = 768

/**
 * A width of 0 means "not measured yet" — `renderToStaticMarkup` and the first
 * paint before a ResizeObserver fires both report 0. Both predicates return
 * false in that state so callers fall through to their desktop/CSS default
 * rather than flashing the mobile layout during hydration.
 */
function isMeasured(width: number): boolean {
  return Number.isFinite(width) && width > 0
}

export function isMobileViewport(width: number): boolean {
  return isMeasured(width) && width < BREAKPOINT_MD
}

export function isDesktopViewport(width: number): boolean {
  return isMeasured(width) && width >= BREAKPOINT_MD
}
