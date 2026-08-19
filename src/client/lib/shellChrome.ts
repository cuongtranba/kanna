/**
 * Shell chrome geometry.
 *
 * The app is two columns: the sidebar and the page outlet. Both open with a
 * chrome band at the very top — the sidebar's brand header, and (on the chat
 * route) each pane's tab strip. Those two bands are the first thing the eye
 * pairs up, so they have to share a top edge, a label line, and a bottom
 * border.
 *
 * They drifted because each carried its own literal height (55/64px in the
 * sidebar, a 36px constant in the tab strip) with nothing tying them together.
 * The height now lives once, in `--shell-top-band` (src/index.css), which also
 * owns the md breakpoint step; these classes are the only sanctioned way to
 * read it. Do not re-type a pixel height at a call site — that is exactly the
 * drift this module exists to prevent.
 */

/** The CSS custom property holding the band height. Defined in src/index.css. */
export const SHELL_TOP_BAND_VAR = "--shell-top-band"

/**
 * Height utilities for a top chrome band. Both `h-` and `max-h-` so a band
 * whose content overflows still cannot push its bottom border out of line with
 * the other column's.
 */
export const SHELL_TOP_BAND_CLASS =
  "h-[var(--shell-top-band)] max-h-[var(--shell-top-band)]"

/**
 * The page outlet's inset, mirroring the sidebar's own `md:my-2` card so the
 * two columns' top edges start on the same line. Below md the sidebar is a
 * full-screen overlay, so there is nothing to align to and the outlet stays
 * flush.
 */
export const SHELL_CONTENT_CARD_CLASS =
  "md:my-2 md:mr-2 md:rounded-2xl md:border md:border-border"

/**
 * The scroll container every full-page route under the shell must own.
 *
 * The app frame is `h-[100dvh] overflow-hidden` and the outlet wrapper is
 * `flex flex-1 flex-col overflow-hidden`, so nothing above a page scrolls. A
 * page that does not scroll itself is simply clipped at the viewport edge —
 * no scrollbar, no touch scroll, and the content below the fold is
 * unreachable. `/cron` shipped exactly that defect (issue #772): the root was
 * a plain centred block with no height participation at all.
 *
 * `min-h-0` is not decoration. A flex child defaults to `min-height: auto` and
 * refuses to shrink below its content, so `overflow-y-auto` alone never
 * engages and the page grows past the frame instead of scrolling inside it.
 *
 * Put this on the page ROOT and keep any `max-w-*` reading column INSIDE it,
 * so the scrollbar lands on the viewport edge rather than mid-page.
 */
export const SHELL_PAGE_SCROLL_CLASS = "flex min-h-0 flex-1 flex-col overflow-y-auto"
